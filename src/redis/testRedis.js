// import redisClient from "./redisClient.js";

// async function test() {
//     try {
//         console.log("Setting value...");

//         await redisClient.set("test", "hello");

//         const value = await redisClient.get("test");

//         console.log("Value from Redis:", value);

//         process.exit(0);
//     } catch (err) {
//         console.error(err);
//         process.exit(1);
//     }
// }

// test();



import {
  getSuccessRedis,
  getFailureRedis,
  getConnectionsRedis
} from './redisMetrics.js'

const url = 'http://localhost:5001'

console.log(
  'Connections:',
  await getConnectionsRedis(url)
)

console.log(
  'Success:',
  await getSuccessRedis(url)
)

console.log(
  'Failure:',
  await getFailureRedis(url)
)

process.exit(0)