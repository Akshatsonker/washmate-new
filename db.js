const mongoose = require('mongoose');
require('dotenv').config(); // Add this line to load environment variables

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI); // Use environment variable
    console.log("MongoDB Connected ✅");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

module.exports = connectDB;