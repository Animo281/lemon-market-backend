import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import { createMemoryRepository } from './repositories/sessionRepository'
import { createSessionRouter } from './routes/session'
import { errorHandler } from './middleware/errorHandler'
import { openApiSpec } from './docs/openapi'

const repo = createMemoryRepository()
const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/session', createSessionRouter(repo))

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec))

app.use(errorHandler)

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, () => console.log(`Backend running on :${PORT}`))
