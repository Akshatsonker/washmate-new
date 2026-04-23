const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  studentId: String,
  vendorId: String,
  serviceType: String,
  quantity: Number,
  price: Number,
  status: String,
  pickupDate: Date,
  deliveryDate: Date,
});

module.exports = mongoose.model('Order', orderSchema);