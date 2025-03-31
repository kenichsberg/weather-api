import { Pool, Client } from 'pg'
import dotenv from 'dotenv'

const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env'
dotenv.config({ path: envFile })

const baseConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
}

const dbConfig = { ...baseConfig, database: process.env.DB_NAME }

const pool = new Pool(dbConfig)


async function initDb () {
  const client =  new Client({
    ...baseConfig,
    database: 'template1'
  })
  await client.connect()
  
  try {
    try {
      await client.query(`CREATE DATABASE ${process.env.DB_NAME}`)
    } catch {
      console.log(`${process.env.DB_NAME} already exists. Skip 'CREATE DATSBASE'`)
    }
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis')

    const poolClient = await pool.connect()
    try {
      await poolClient.query(`
        CREATE TABLE IF NOT EXISTS cities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        city TEXT NOT NULL,
        lat DOUBLE PRECISION NOT NULL,
        lon DOUBLE PRECISION NOT NULL,
        temp DOUBLE PRECISION NOT NULL,
        humidity DOUBLE PRECISION NOT NULL,
        geom GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lon, lat), 4326)) STORED
        )
        `)
    } finally {
      poolClient.release()
    }
  } finally {
    await client.end()
  }
}

export { dbConfig, pool, initDb }

