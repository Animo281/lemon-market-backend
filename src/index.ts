import express from 'express'
import cors from 'cors'
import sessionRouter from './routes/session'

const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/session', sessionRouter)

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, () => console.log(`Backend läuft auf :${PORT}`))
