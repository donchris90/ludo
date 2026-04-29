// src/utils/queues.ts
import Queue from 'bull';

let gameQueue: Queue.Queue | null = null;
let notificationQueue: Queue.Queue | null = null;
let initialized = false;

export async function initQueues() {
  if (initialized) {
    return { gameQueue, notificationQueue };
  }

  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  try {
    // Only attempt with timeout
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
    );

    await Promise.race([
      (async () => {
        gameQueue = new Queue('game queue', redisUrl);
        notificationQueue = new Queue('notification queue', redisUrl);

        // Test connection
        await gameQueue.client.ping();

        gameQueue.process(async (job) => {
          console.log('Processing game job:', job.data);
          return { success: true };
        });

        notificationQueue.process(async (job) => {
          console.log('Processing notification:', job.data);
          return { success: true };
        });

        console.log('✅ Queues initialized');
        initialized = true;
      })(),
      timeoutPromise
    ]);
  } catch (error) {
    console.log('⚠️ Queue initialization failed, using in-memory fallback');
    gameQueue = null;
    notificationQueue = null;
    initialized = true;
  }

  return { gameQueue, notificationQueue };
}

export function getQueues() {
  return { gameQueue, notificationQueue };
}

export async function addToGameQueue(data: any) {
  if (gameQueue) {
    return await gameQueue.add(data);
  }
  console.log('Mock add to game queue:', data);
  return { id: Date.now().toString() };
}

export async function addToNotificationQueue(data: any) {
  if (notificationQueue) {
    return await notificationQueue.add(data);
  }
  console.log('Mock add to notification queue:', data);
  return { id: Date.now().toString() };
}