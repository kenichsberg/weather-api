import { Router, Request, Response } from 'express'
import { pool } from './db.js'
import { PoolClient } from 'pg'
import multer from 'multer'
import { createReadStream } from 'fs'
import path from 'path'
import copy from 'pg-copy-streams'
import * as JSONStream from 'jsonstream-next'
import { randomUUID } from 'crypto'

const router = Router()
const copyFrom = copy.from
const upload = multer({ dest: 'uploads/' })

const BATCH_SIZE = 10000
const MAX_CONCURRENT_BATCHES = 5
const MAX_JOBS = 10

const jobStatuses: Map<string, { status: string; processed: number }> = new Map()

let isBulkInsertRunning = false

type Weather = {
  city: string
  lat: number
  lon: number
  temp: number
  humidity: number
}

function addJob(jobId: string) {
  if (jobStatuses.size >= MAX_JOBS) {
    const oldestKey = jobStatuses.keys().next().value ?? ''
    removeJob(oldestKey)
  }

  return jobStatuses.set(jobId, {
    status: 'in-progress',
    processed: 0,
  })
}

function getJobStatus(jobId: string) {
  return jobStatuses.get(jobId)
}

function updateJobStatus(jobId: string, status: string, processedInc: number = 0) {
  const jobStatus = getJobStatus(jobId)
  if (!jobStatus) return

  return jobStatuses.set(jobId, {
    status,
    processed: jobStatus.processed + processedInc,
  })
}

function removeJob(jobId: string) {
  return jobStatuses.delete(jobId)
}

async function createCitiesStagingTable(client: PoolClient) {
  return await client.query(`
    CREATE UNLOGGED TABLE IF NOT EXISTS _cities_staging AS TABLE cities;
    ALTER TABLE _cities_staging ALTER id SET DEFAULT gen_random_uuid();
    ALTER TABLE _cities_staging DROP COLUMN geom;
    ALTER TABLE _cities_staging ADD COLUMN geom GEOMETRY(Point, 4326) 
      GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED;
  `)
}

async function copyBatchToStaging(client: PoolClient, records: Weather[]) {
  return new Promise<void>((resolve, reject) => {
    const stream = client.query(
      copyFrom(`COPY _cities_staging (city, lat, lon, temp, humidity) FROM STDIN WITH (FORMAT csv)`),
    )

    const transformedRecords = records
      .map((record) => {
        return `${record.city},${record.lat},${record.lon},${record.temp},${record.humidity}\n`
      })
      .join('')

    stream.write(transformedRecords)
    stream.end()

    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

async function swapCitiesTables(client: PoolClient) {
  return await client.query(`
    BEGIN;
    DROP TABLE cities;
    ALTER TABLE _cities_staging SET LOGGED;
    ALTER TABLE _cities_staging RENAME TO cities;
    ALTER TABLE cities ADD PRIMARY KEY (id);
    COMMIT;
  `)
}

async function runBulkInsert(jobId: string, filePath: string) {
  const fileStream = createReadStream(filePath)
  const jsonStream = fileStream.pipe(JSONStream.parse('*'))

  let batch: Weather[] = []
  let batchPromises: Promise<void>[] = []

  jsonStream.on('data', async (record) => {
    batch.push(record)

    if (batch.length >= BATCH_SIZE) {
      const batchCopy = batch
      batch = []

      if (batchPromises.length >= MAX_CONCURRENT_BATCHES) {
        await Promise.race(batchPromises)
      }

      const batchClient = await pool.connect()
      const batchPromise = copyBatchToStaging(batchClient, batchCopy)
        .then(async (_) => {
          updateJobStatus(jobId, 'in-progress', batchCopy.length)
        })
        .catch(async (error) => {
          updateJobStatus(jobId, 'failed')
          throw error
        })
        .finally(() => {
          batchClient.release()
          batchPromises = batchPromises.filter((p) => p !== batchPromise)
        })

      batchPromises.push(batchPromise)
    }
  })

  return new Promise<void>((resolve, reject) => {
    jsonStream.on('end', async () => {
      const batchClient = await pool.connect()
      if (batch.length > 0) {
        batchPromises.push(
          copyBatchToStaging(batchClient, batch)
            .then(async (_) => {
              updateJobStatus(jobId, 'in-progress', batch.length)
            })
            .catch(async (error) => {
              updateJobStatus(jobId, 'failed')
              throw error
            })
            .finally(() => {
              batchClient.release()
            }),
        )
      }

      await Promise.all(batchPromises)
      await swapCitiesTables(batchClient)

      updateJobStatus(jobId, 'completed')
      resolve()
    })

    jsonStream.on('error', (error) => {
      console.error(error)
      updateJobStatus(jobId, 'failed')
      reject()

      throw error
    })
  })
}

function celsiusToFahrenheit(celsius: number) {
  return (celsius * 9) / 5 + 32
}

// Bulk insert endpoint
router.post('/bulk-insert', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).send('File is required')
  }

  if (path.extname(req.file.originalname) !== '.json') {
    return res.status(400).send('Invalid file type: required .json')
  }

  const jobId = randomUUID()

  if (isBulkInsertRunning) {
    return res.status(429).json({ message: 'Bulk insert already in progress. Try again later.' })
  }

  isBulkInsertRunning = true
  addJob(jobId)

  res
    .status(202)
    .set('Location', `/api/bulk-insert/status/${jobId}`)
    .json({ jobId, status: 'in-progress', processed: 0 })
  ;(async (filePath) => {
    const client = await pool.connect()

    try {
      await createCitiesStagingTable(client)
      await runBulkInsert(jobId, filePath)
    } catch (error) {
      console.error(error)
      updateJobStatus(jobId, 'failed')
    } finally {
      isBulkInsertRunning = false
      await client.query('DROP TABLE IF EXISTS _cities_staging;')
      client.release()
    }
  })(req.file.path)
})

// Job status endpoint
router.get('/bulk-insert/status/:jobId', (req, res) => {
  const job = getJobStatus(req.params.jobId)
  if (!job) return res.status(404).send('Job not found')

  res.status(200).json(job)
})

// Nearest city endpoint
router.get('/nearest-city', async (req, res, next) => {
  const { lat: _lat, lon: _lon, unit = 'C' } = req.query

  if (!_lat || !_lon) {
    return res.status(400).send('lat and lon are required')
  }

  const latitude = parseFloat(_lat as string)
  const longitude = parseFloat(_lon as string)
  if (isNaN(latitude)) return res.status(400).send(`Invalid lat value: '${_lat}'`)
  if (isNaN(longitude)) return res.status(400).send(`Invalid lon value: '${_lon}'`)

  try {
    const result = await pool.query<Weather>(
      `
      SELECT city, lat, lon, temp, humidity, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS distance
      FROM cities
      ORDER BY distance
      LIMIT 1
    `,
      [longitude.toString(), latitude.toString()],
    )

    if (result.rows.length === 0) {
      return res.status(404).send('No city found')
    }

    const { city, lat, lon, temp, humidity } = result.rows[0]

    if (unit === 'F') {
      return res.status(200).json({
        city,
        lat,
        lon,
        humidity,
        temp: celsiusToFahrenheit(temp),
      })
    }

    res.status(200).json({ city, lat, lon, temp, humidity })
  } catch (error: any) {
    next(error)
  }
})

export { router }
