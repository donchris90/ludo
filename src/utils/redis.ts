// src/utils/redis.ts
import Redis from 'ioredis';

let redisClient: Redis | null = null;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

export async function initRedis() {
  try {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    // Only try to connect if we haven't exceeded max attempts
    if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.log('⚠️ Redis: Max connection attempts reached, using in-memory fallback');
      return null;
    }

    connectionAttempts++;

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > MAX_RECONNECT_ATTEMPTS) {
          console.log('⚠️ Redis: Giving up after', MAX_RECONNECT_ATTEMPTS, 'attempts');
          return null; // Stop retrying
        }
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });

    // Set up event handlers
    redisClient.on('error', (err) => {
      // Silently handle errors after max attempts
      if (connectionAttempts >= MAX_RECONNECT_ATTEMPTS) {
        // Do nothing - we're in fallback mode
      } else {
        console.warn('⚠️ Redis error:', err.message);
      }
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis connected');
      connectionAttempts = 0; // Reset on successful connection
    });

    // Try to connect with timeout
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
    ]);

    console.log('✅ Redis initialized successfully');
    return redisClient;

  } catch (error) {
    console.log('⚠️ Redis not available, using in-memory fallback');
    redisClient = null;
    return null;
  }
}

export function getRedisClient() {
  return redisClient;
}

// In-memory fallback
const memoryStore = new Map<string, string>();

export async function getAsync(key: string): Promise<string | null> {
  if (redisClient) {
    try {
      return await redisClient.get(key);
    } catch {
      return memoryStore.get(key) || null;
    }
  }
  return memoryStore.get(key) || null;
}

export async function setAsync(key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (redisClient) {
    try {
      if (ttlSeconds) {
        await redisClient.setex(key, ttlSeconds, value);
      } else {
        await redisClient.set(key, value);
      }
    } catch {
      memoryStore.set(key, value);
    }
  } else {
    memoryStore.set(key, value);
  }
}

export async function delAsync(key: string): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.del(key);
    } catch {
      memoryStore.delete(key);
    }
  } else {
    memoryStore.delete(key);
  }
}