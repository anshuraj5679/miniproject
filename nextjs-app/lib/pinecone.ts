import { Pinecone } from '@pinecone-database/pinecone'

if (!process.env.PINECONE_API_KEY) {
    throw new Error('PINECONE_API_KEY is not set')
}

const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
})

export const indexName = 'safebill-index'

// Helper to get the index (creates it if it doesn't exist - though free tier might limit this)
export async function getPineconeIndex() {
    const existingIndexes = await pinecone.listIndexes()

    // Check if index exists
    const indexExists = existingIndexes.indexes?.some(index => index.name === indexName)

    if (!indexExists) {
        console.log(`Creating index: ${indexName}`)
        await pinecone.createIndex({
            name: indexName,
            dimension: 1536, // OpenAI text-embedding-3-small dimension
            metric: 'cosine',
            spec: {
                serverless: {
                    cloud: 'aws',
                    region: 'us-east-1'
                }
            }
        })

        // Wait for index ensuring readiness
        // In a real app we might poll status, but for now just wait a bit
        await new Promise(resolve => setTimeout(resolve, 5000))
    }

    return pinecone.index(indexName)
}
