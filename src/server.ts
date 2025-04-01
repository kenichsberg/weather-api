import { app } from './app.js'
import { initDb } from './db.js'

const port = 3000

app.listen(port, async () => {
  await initDb()
  console.log(`Server running on http://localhost:${port}`)
})