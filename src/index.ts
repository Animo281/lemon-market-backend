import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import sessionRouter from './routes/session'

const app = express()
app.use(cors())
app.use(express.json())
app.use('/api/session', sessionRouter)

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Lemon Market API', version: '1.0.0' },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        token: { type: 'apiKey', in: 'header', name: 'x-token' },
      },
    },
  },
  apis: [],
})

// Manual route docs
const paths: Record<string, object> = {
  '/session': {
    post: {
      summary: 'Create session',
      tags: ['Session'],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
        numSellers: { type: 'integer', default: 3 },
        numBuyers: { type: 'integer', default: 4 },
        maxSellerUnits: { type: 'integer', default: 2 },
        totalRounds: { type: 'integer', default: 5 },
      }}}}},
      responses: { 200: { description: '{ code, adminToken, sessionId }' } },
    },
  },
  '/session/{code}': {
    get: {
      summary: 'Get session state',
      tags: ['Session'],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'PublicSession' }, 404: { description: 'Not found' } },
    },
  },
  '/session/{code}/join': {
    post: {
      summary: 'Join session',
      tags: ['Session'],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name','role','slotIndex'], properties: {
        name: { type: 'string' }, role: { type: 'string', enum: ['seller','buyer'] }, slotIndex: { type: 'integer' },
      }}}}},
      responses: { 200: { description: '{ playerToken, playerId, session }' } },
    },
  },
  '/session/{code}/start': {
    post: {
      summary: 'Start game (admin)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'PublicSession' }, 403: { description: 'Forbidden' } },
    },
  },
  '/session/{code}/config': {
    patch: {
      summary: 'Update config (admin, lobby only)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
        maxSellerUnits: { type: 'integer' }, totalRounds: { type: 'integer' },
      }}}}},
      responses: { 200: { description: 'PublicSession' } },
    },
  },
  '/session/{code}/seller-decision': {
    post: {
      summary: 'Submit seller decision',
      tags: ['Player'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['grade','price'], properties: {
        grade: { type: 'integer', enum: [1,2,3] }, price: { type: 'number' }, unitsOffered: { type: 'integer' },
      }}}}},
      responses: { 200: { description: 'PublicSession' } },
    },
  },
  '/session/{code}/buyer-decision': {
    post: {
      summary: 'Submit buyer decision',
      tags: ['Player'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', properties: {
        sellerId: { type: 'string', nullable: true },
      }}}}},
      responses: { 200: { description: 'PublicSession' } },
    },
  },
  '/session/{code}/toggle-info-mode': {
    post: {
      summary: 'Switch to asymmetric info mode (admin)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'PublicSession' } },
    },
  },
  '/session/{code}/next-round': {
    post: {
      summary: 'Advance to next round (admin)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 200: { description: 'PublicSession' } },
    },
  },
}

;(swaggerSpec as { paths: object }).paths = paths
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, () => console.log(`Backend läuft auf :${PORT}`))
