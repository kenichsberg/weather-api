import fs, { writeFileSync } from 'fs'
import { faker } from '@faker-js/faker'

type Weather = {
  city: string
  lat: number
  lon: number
  temp: number
  humidity: number
}

const generateRandomGeo = () => {
  const lat = (Math.random() * 180 - 90).toFixed(6)  
  const lon = (Math.random() * 360 - 180).toFixed(6) 
  return { lat, lon }
}


const generateRandomWeatherData = (): Weather => {
  const { lat, lon } = generateRandomGeo()

  return {
    city: faker.location.city(),
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    temp: parseFloat((Math.random() * 60 - 20).toFixed(1)),
    humidity: parseFloat((Math.random() * 100).toFixed(1))
  }
}


const generateSampleData = (filePath:string, numCities: number) => {
  let remainingRows = numCities
  let weathers: Weather[]
  let batchStr: string
  let isFirstWrite = true
  const ws = fs.createWriteStream(filePath, { flags: 'a' });

  ws.write('[\n')
  while (remainingRows > 0) {
    // This is slower.
    /*
    if (isFirstWrite) {
      isFirstWrite = false
    } else {
      ws.write(',\n')
    }
    ws.write(JSON.stringify(generateRandomWeatherData(), null, 2))
    remainingRows--
    if (remainingRows % 1_000_000 === 0) console.log('Remaining rows: ', remainingRows)
    */
    if (isFirstWrite) {
      isFirstWrite = false
    } else {
      ws.write(',\n')
    }

    const batchSize = Math.min(remainingRows, 1_000_000)
    weathers = []

    for (let i = 0; i < batchSize; i++) {
      weathers.push(generateRandomWeatherData())
    }

    batchStr = JSON.stringify(weathers, null, 2)
    batchStr = batchStr.substring(1, batchStr.length - 1)
    ws.write(batchStr)
    
    remainingRows -= batchSize
    console.log('Remaining rows: ', remainingRows)
  }
  ws.write(']\n')
  ws.end()
}

const filePath = './tests/fixtures/large-sample.json'

generateSampleData(filePath, 10_000_000)


console.log(`Sample data generated and saved to ${filePath}`)

