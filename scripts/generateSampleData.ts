import { writeFileSync } from 'fs'
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

  while (remainingRows > 0) {
    const batchSize = Math.min(remainingRows, 1_000_000)
    weathers = []
    for (let i = 0; i < batchSize; i++) {
      weathers.push(generateRandomWeatherData())
    }
    writeFileSync(filePath, JSON.stringify(weathers, null, 2), { flush: true})
    remainingRows -= batchSize
    console.log('Remaining rows: ', remainingRows)
  }
}

const filePath = './tests/fixtures/large-sample.json'

generateSampleData(filePath, 1_000_000_000)


console.log(`Sample data generated and saved to ${filePath}`)

