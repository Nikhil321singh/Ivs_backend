const mongoose = require('mongoose');
const env = require('./env');

mongoose.set('strictQuery', true);

const connectDB = async () => {
  try {
    await mongoose.connect(env.mongodbUri);
    // eslint-disable-next-line no-console
    console.log(`MongoDB connected: ${mongoose.connection.host}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  // eslint-disable-next-line no-console
  console.warn('MongoDB disconnected.');
});

mongoose.connection.on('error', (error) => {
  // eslint-disable-next-line no-console
  console.error(`MongoDB connection error: ${error.message}`);
});

module.exports = connectDB;
