import express, { Request, Response, NextFunction } from 'express'
import { router } from './routes.js'

const app = express()

app.use(express.json())
app.use('/api', router)
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).send()
})

export { app }
