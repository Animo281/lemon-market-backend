import express from 'express'
import cors from 'cors'
import sessionRouter from './routes/session'

const app = express()
app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())
app.use('/api/session', sessionRouter)

app.listen(3001, () => console.log('Backend läuft auf :3001'))
