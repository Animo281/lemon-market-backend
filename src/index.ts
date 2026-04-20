import express from 'express'
import cors from 'cors'
import swaggerUi from 'swagger-ui-express'
import swaggerJsdoc from 'swagger-jsdoc'
import { createMemoryRepository } from './repositories/sessionRepository'
import { createSessionRouter } from './routes/session'
import { errorHandler } from './middleware/errorHandler'

const repo = createMemoryRepository()
const app = express()

app.use(cors())
app.use(express.json())
app.use('/api/session', createSessionRouter(repo))

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: { title: 'Lemon Market API', version: '1.0.0' },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        token: { type: 'apiKey', in: 'header', name: 'x-token' },
      },
      schemas: {
        PublicPlayer: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['seller', 'buyer'] },
            slotIndex: { type: 'integer' },
          },
        },
        PublicSession: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string' },
            phase: { type: 'string', enum: ['lobby', 'seller-input', 'market', 'round-end', 'game-end'] },
            currentRound: { type: 'integer' },
            infoMode: { type: 'string', enum: ['full', 'asymmetric'] },
            numSellers: { type: 'integer' },
            numBuyers: { type: 'integer' },
            maxSellerUnits: { type: 'integer' },
            totalRounds: { type: 'integer' },
            players: { type: 'array', items: { $ref: '#/components/schemas/PublicPlayer' } },
            results: { type: 'array', items: { $ref: '#/components/schemas/RoundResult' } },
          },
        },
        RoundResult: {
          type: 'object',
          properties: {
            round: { type: 'integer' },
            infoMode: { type: 'string', enum: ['full', 'asymmetric'] },
            totalSurplus: { type: 'number' },
            sellerDecisions: { type: 'array', items: { type: 'object' } },
            buyerDecisions: { type: 'array', items: { type: 'object' } },
          },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
    },
  },
  apis: [],
})

const paths: Record<string, object> = {
  '/session': {
    post: {
      summary: 'Create session',
      tags: ['Session'],
      requestBody: {
        content: { 'application/json': { schema: { type: 'object', properties: {
          numSellers: { type: 'integer', default: 3 },
          numBuyers: { type: 'integer', default: 4 },
          maxSellerUnits: { type: 'integer', default: 2 },
          totalRounds: { type: 'integer', default: 5 },
        }}}},
      },
      responses: {
        200: { description: '{ code, adminToken, sessionId }' },
        400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}': {
    get: {
      summary: 'Get session state',
      tags: ['Session'],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}/join': {
    post: {
      summary: 'Join session',
      tags: ['Session'],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['name', 'role', 'slotIndex'], properties: {
        name: { type: 'string' }, role: { type: 'string', enum: ['seller', 'buyer'] }, slotIndex: { type: 'integer' },
      }}}}},
      responses: {
        200: { description: '{ playerToken, playerId, session }' },
        400: { description: 'Validation / phase error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        409: { description: 'Slot taken', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}/start': {
    post: {
      summary: 'Start game (admin)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
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
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}/seller-decision': {
    post: {
      summary: 'Submit seller decision',
      tags: ['Player'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['grade', 'price'], properties: {
        grade: { type: 'integer', enum: [1, 2, 3] }, price: { type: 'number', minimum: 0 }, unitsOffered: { type: 'integer' },
      }}}}},
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}/buyer-decision': {
    post: {
      summary: 'Submit buyer decision',
      tags: ['Player'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['sellerId'], properties: {
        sellerId: { type: 'string', nullable: true },
      }}}}},
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}/toggle-info-mode': {
    post: {
      summary: 'Switch to asymmetric info mode (admin)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
  '/session/{code}/next-round': {
    post: {
      summary: 'Advance to next round (admin)',
      tags: ['Admin'],
      security: [{ token: [] }],
      parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: { description: 'PublicSession', content: { 'application/json': { schema: { $ref: '#/components/schemas/PublicSession' } } } },
        403: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    },
  },
}

;(swaggerSpec as { paths: object }).paths = paths
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec))

app.use(errorHandler)

const PORT = Number(process.env.PORT) || 3001
app.listen(PORT, () => console.log(`Backend running on :${PORT}`))
