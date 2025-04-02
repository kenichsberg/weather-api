import express, { Request, Response, ErrorRequestHandler, NextFunction } from 'express'
import { router } from './routes.js'

const app = express()

app.use(express.json())
app.use('/api', router)
app.use((err: ErrorRequestHandler, req: Request, res: Response, next: NextFunction) => {
    res.status(500).send();
});

export { app }