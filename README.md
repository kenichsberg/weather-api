## How to run locally

```
git clone git@github.com:kenichsberg/weather-api.git
cd weather-api
docker compose build api
docker compose up -d
```
Node.js application starts listening on [localhost:3000](http://localhost:3000)
<br/><br/>

## API specification

### File upload endpoint
```http
POST  /api/bulk-insert
```
Asynchronously Upload a file and save data in DB. Immediately returns `202` with `Location` header for monitoring progress.

This endpoint doesn't accept concurrent requests and in case there is an ongoing process, returns `429`.

##### Parameters

> No query parameters

##### Body

> | key      |  type     | value              | description                                                           |
> |-----------|-----------|-------------------------|-----------------------------------------------------------------------|
> | file      |  required | file (.json)   | a JSON file as descripted in the task assignment  |


##### Responses

> | http code     | content-type                      | response                                                            |
> |---------------|-----------------------------------|---------------------------------------------------------------------|
> | `202`         | `application/json`          | `{ jobId: <jobId>, status: 'in-progress', processed: 0 }`                                |
> | `400`         | `text/plain;charset=UTF-8`                | `'File is required'`                            |
> | `429`         | `application/json`        | ` { message: 'Bulk insert already in progress. Try again later.' }`                                                            |

<br/>

### File upload status endpoint
```http
GET  /api/bulk-insert/status/<jobId>
```
##### Parameters

> No query parameters

##### Responses

> | http code     | content-type                      | response                                                            |
> |---------------|-----------------------------------|---------------------------------------------------------------------|
> | `200`         | `application/json`       | `{ jobId: <jobId>, status: 'in-progress'\|'completed'\|'failed', processed: <processed row number> }`                                |
> | `404`         | `text/plain;charset=UTF-8`                 | `Job not found`                            |

<br/>

### Nearest location endpoint
```http
GET  /api/nearest-city?lat=<lat>&lon=<lon>&unit=<temp-unit>
```
##### Parameters
> | key      |  type     | value              | description                                                           |
> |-----------|-----------|-------------------------|-----------------------------------------------------------------------|
> | lat      |  required | decimal number   | Latitude to query  |
> | lon      |  required | decimal number   | Longitude to query  |
> | unit      |  optional | `'C'\|'F'`  / default =`'C'` | To show tempertures in °C or °F  |

##### Responses

> | http code     | content-type                      | response                                                            |
> |---------------|-----------------------------------|---------------------------------------------------------------------|
> | `200`         | `application/json`                | `{ city: <city name>, lat: <latitude>, lon: <longitude>, temp: <temperture>, humidity: <humidity> }`      |
> |  `400`        | `text/plain;charset=UTF-8`        |  `'lat and lon are required'`|
> | `404`         | `text/plain;charset=UTF-8`        | `'No city found'`                            |

<br/><br/>

## Design and considerations

### Data schema

Since there were no requirements for data schema, I left data schema as input file format, but for production, the data should be *normalized* (separate cities/lat,lon and temp/hummidity).

I added a **geom** column with the type `Geometry` to efficiently query the nearest location.

### Bulk insert

To optimize performance, the input data are batched and inserted into a *staging* table first via `Copy` command.

After all data are inserted, the existing table will be replaced with the *staging* one.

On my laptop, the import of 10 million records was done in several minutes.

(You can generate a sample JSON file with 10 million records by running the command `npx tsx scripts/generateSampleData.ts`)

### Query the nearest city

I tried to add an index by `CREATE INDEX idx_cities_geom ON cities USING GIST (geom);`.

However, Postgres didn't use it for 10 million records even with  `SET enable_seqscan = OFF`.

After several experiments, I could finally force Postgres to use the index with the following SQL, narrowing the target data-set size with `ST_DWithin`:
```sql
WITH nearest AS (
    SELECT
      id,
      lat,
      lon,
      geom,
      ST_Distance(geom, ST_SetSRID(ST_MakePoint(50, 100), 4326)) AS distance
    FROM cities
    WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(50, 100), 4326), 1000)
    ORDER BY distance
    LIMIT 1
)
SELECT * FROM nearest
UNION ALL
SELECT
  id,
  lat,
  lon,
  geom,
  ST_Distance(geom, ST_SetSRID(ST_MakePoint(50, 100), 4326)) AS distance
FROM cities
WHERE NOT EXISTS (SELECT 1 FROM nearest)
ORDER BY distance
LIMIT 1
```

But to apply this, knowledge about the density (or range) of the actual data is necessary to pick a proper narrowing threshold, and even using the index, the query speed didn't improve on my laptop.

That's why I didn't add the index.
