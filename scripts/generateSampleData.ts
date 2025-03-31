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


const generateSampleData = (numCities: number) => {
  const weathers: Weather[] = []
  for (let i = 0; i < numCities; i++) {
    weathers.push(generateRandomWeatherData())
  }
  return weathers
}


const sampleData = generateSampleData(100)

const filePath = './tests/fixtures/sample.json'
writeFileSync(filePath, JSON.stringify(sampleData, null, 2))

console.log(`Sample data generated and saved to ${filePath}`)

