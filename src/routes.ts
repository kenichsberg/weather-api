import { Router, Request, Response } from 'express'
import { pool } from './db'
import { PoolClient } from 'pg'
import multer from 'multer'
import { createReadStream } from 'fs'
import copy from 'pg-copy-streams'
import * as JSONStream from 'jsonstream-next'
import { randomUUID } from 'crypto'

const router = Router()
const copyFrom = copy.from
const upload = multer({ dest: 'uploads/' })

const BATCH_SIZE = 10000
const MAX_CONCURRENT_BATCHES = 5
const MAX_JOBS = 10


const jobStatuses: Map<string, { status: string, processed: number}>
 = new Map()


let isBulkInsertRunning = false


type Weather = {
  city: string
  lat: number
  lon: number
  temp: number
  humidity: number
}


function addJob (jobId: string) {
  if (jobStatuses.size >= MAX_JOBS) {
    const oldestKey = jobStatuses.keys().next().value ?? ''
    jobStatuses.delete(oldestKey)
  }

  return jobStatuses.set(jobId, {
     status: 'in-progress',
     processed: 0,
   })
}


function getJobStatus (jobId: string) {
  return jobStatuses.get(jobId)
}


function updateJobStatus(
  jobId: string,
  status: string,
  processedInc: number = 0
) {
  const jobStatus = getJobStatus(jobId)
  if (!jobStatus) return

  return jobStatuses.set(
    jobId,
    {
      status,
      processed: jobStatus.processed + processedInc,
    }
  )
}


function removeJob (jobId: string) {
  return jobStatuses.delete(jobId)
}


async function createTempCitiesTable (client: PoolClient) {
  return await client.query(`
    CREATE TEMP TABLE IF NOT EXISTS temp_cities (
      city TEXT,
      lat DOUBLE PRECISION,
      lon DOUBLE PRECISION,
      temp DOUBLE PRECISION,
      humidity DOUBLE PRECISION
    );
  `)
}


async function dropTempCitiesTable(client: PoolClient) {
  return await client.query(`DROP TABLE temp_cities;`)
}


async function mergeCitiesTables(client: PoolClient) {
  return await client.query(`
    BEGIN;
    INSERT INTO cities (city, lat, lon, temp, humidity)
    SELECT city, lat, lon, temp, humidity FROM temp_cities;
    COMMIT;
  `)
}


async function insertBatch(client: PoolClient, records: Weather[]) {
  return new Promise<void>((resolve, reject) => {
    const stream = client.query(copyFrom(`COPY temp_cities (city, lat, lon, temp, humidity) FROM STDIN WITH (FORMAT csv)`))

    const transformedRecords = records.map(record => {
      return `${record.city},${record.lat},${record.lon},${record.temp},${record.humidity}\n`
    }).join('')

    stream.write(transformedRecords)
    stream.end()

    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}


async function runBulkInsert(jobId: string, filePath: string) {
  addJob(jobId)

  const client = await pool.connect()
  await createTempCitiesTable(client)

  const fileStream = createReadStream(filePath)
  const jsonStream = fileStream.pipe(JSONStream.parse('*'))

  let batch: Weather[] = []
  let batchPromises: Promise<void>[] = []
  let processedCount = 0

  jsonStream.on('data', async (record) => {
    batch.push(record)

    if (batch.length >= BATCH_SIZE) {
      const batchCopy = batch
      batch = []

      if (batchPromises.length >= MAX_CONCURRENT_BATCHES) {
        await Promise.race(batchPromises)
      }

      const batchPromise = insertBatch(client, batchCopy).finally(() => {
        processedCount += batchCopy.length
        updateJobStatus(jobId, 'in-progress', processedCount)
        batchPromises = batchPromises.filter(p => p !== batchPromise)
      })

      batchPromises.push(batchPromise)
    }
  })


  return new Promise<void>((resolve, reject) => {
    jsonStream.on('end', async () => {
      if (batch.length > 0) {
        batchPromises.push(insertBatch(client, batch).finally(() => {
          processedCount += batch.length
        }))
      }

      await Promise.all(batchPromises)
      await mergeCitiesTables(client)
      await dropTempCitiesTable(client)
      updateJobStatus(jobId, 'completed', processedCount)

      isBulkInsertRunning = false
      client.release()
      resolve()
    })

    jsonStream.on('error', async (err) => {
      console.error(err)
      await dropTempCitiesTable(client)
      updateJobStatus(jobId, 'failed')

      isBulkInsertRunning = false
      client.release()
      reject()
    })

  })
}


function celsiusToFahrenheit(celsius: number) {
  return  celsius * 9 / 5 + 32
}


// Bulk insert endpoint
router.post('/bulk-insert', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).send('File is required')
  }

  const isAsync = req.query.async === 'true'
  const jobId = randomUUID()

  if (isBulkInsertRunning) {
    return res.status(429).json({ message: 'Bulk insert already in progress. Try again later.' })
  }

  isBulkInsertRunning = true
  
  if (isAsync) {
    res.status(202)
      .set('Location', `/status/${jobId}`)
      .json({ jobId, status: 'in-progress', processed: 0 })
    await runBulkInsert(jobId, req.file.path)
    return
  } 

  await runBulkInsert(jobId, req.file.path)
  const jobStatus = getJobStatus(jobId)
  removeJob(jobId)

  if (jobStatus?.status === 'completed') {
    res.status(200).json(jobStatus)
  } else {
    res.status(500).json({ message: 'Bulk insert failed'})
  }
})


// Job status endpoint
router.get('/bulk-insert/status/:jobId', (req: Request, res: Response) => {
  const job = getJobStatus(req.params.jobId)
  if (!job) return res.status(404).send('Job not found')
  res.json(job)
})



// Nearest city endpoint
router.get('/nearest-city', async (req, res) => {
  const { lat, lon, unit = 'C' } = req.query
  if (!lat || !lon) return res.status(400).send('lat and lon are required')

  const result = await pool.query(`
      SELECT city, lat, lon, temp, humidity, ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS distance
      FROM cities
      ORDER BY distance
      LIMIT 1
    `, [parseFloat(lon as string), parseFloat(lat as string)])

  if (result.rows.length === 0) return res.status(404).send('No city found')

  const { distance, ...response } = result.rows[0]
  
  if (unit === 'F') {
    res.json({
       ...response,
       temp: celsiusToFahrenheit(response.temp)
    })
  } else {
    res.json(response)
  }
})



export { router }