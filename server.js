require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');

const User = require('./models/user');
const Order = require('./models/order');
const Message = require('./models/message');
const connectDB = require('./db');

const app = express();
const server = http.createServer(app);

// ─────────────────────────────────────────────
// 🔌 SOCKET.IO SETUP
// ─────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

connectDB();

app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());

const SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 5000;

app.set('io', io);

// ─────────────────────────────────────────────
// 🔌 SOCKET.IO EVENTS
// ─────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('join_order', (orderId) => {
    socket.join(orderId);
    console.log(`Socket ${socket.id} joined room: ${orderId}`);
  });

  socket.on('leave_order', (orderId) => {
    socket.leave(orderId);
    console.log(`Socket ${socket.id} left room: ${orderId}`);
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ─────────────────────────────────────────────
// 🔐 AUTH MIDDLEWARE
// ─────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'No token provided' });

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Test Route

app.get("/status", async(req, res) => {
  return res.status(200).json({"message":"App is running fine."});
});

// ─────────────────────────────────────────────
// 🔐 REGISTER
// ─────────────────────────────────────────────
app.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name)
      return res.status(400).json({ message: 'All fields are required' });

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const VENDOR_EMAILS = ['keshavlaundry@gmail.com'];
    const role = VENDOR_EMAILS.includes(email) ? 'vendor' : 'student';

    const newUser = new User({ email, password: hashed, name, role });
    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id.toString(), role: newUser.role },
      SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        // ✅ Always send id as a plain string — never as ObjectId
        id: newUser._id.toString(),
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// 🔐 LOGIN
// ─────────────────────────────────────────────
app.post('/login', async (req, res) => {
  try {
    console.log('Login attempt:', req.body);
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'User not found' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: 'Wrong password' });

    const token = jwt.sign(
      { id: user._id.toString(), role: user.role },
      SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        // ✅ Always send id as a plain string — never as ObjectId
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─────────────────────────────────────────────
// 📦 ORDERS
// ─────────────────────────────────────────────
app.post('/orders', authMiddleware, async (req, res) => {
  try {
    const { serviceType, quantity, price, notes, pickupDate } = req.body;
    if (!serviceType || !quantity || !price)
      return res.status(400).json({ message: 'serviceType, quantity and price are required' });

    const deliveryDate = new Date();
    deliveryDate.setDate(deliveryDate.getDate() + 5);

    const vendorUser = await User.findOne({ role: 'vendor' });
    const vendorId = vendorUser ? vendorUser._id.toString() : 'vendor_main';
    const vendorName = vendorUser ? vendorUser.name : 'Keshav';

    const order = new Order({
      studentId: req.user.id,
      vendorId,
      vendorName,
      serviceType,
      quantity,
      price,
      notes: notes || '',
      status: 'placed',
      pickupDate: pickupDate ? new Date(pickupDate) : new Date(),
      deliveryDate,
    });

    await order.save();

    const studentUser = await User.findById(req.user.id);
    const orderObj = order.toObject();
    orderObj._id = orderObj._id.toString();
    orderObj.studentName = studentUser ? studentUser.name : 'Student';

    res.json(orderObj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error creating order' });
  }
});

app.get('/orders', authMiddleware, async (req, res) => {
  try {
    const { role, id } = req.user;
    let orders;

    if (role === 'student') {
      orders = await Order.find({ studentId: id }).sort({ createdAt: -1 });
    } else if (role === 'vendor') {
      orders = await Order.find({ vendorId: id }).sort({ createdAt: -1 });
    } else if (role === 'admin') {
      orders = await Order.find({}).sort({ createdAt: -1 });
    } else {
      orders = [];
    }

    const populated = await Promise.all(
      orders.map(async (o) => {
        const obj = o.toObject();
        // ✅ Stringify all ObjectId fields so frontend comparisons always work
        obj._id = obj._id.toString();
        obj.studentId = obj.studentId?.toString();
        obj.vendorId = obj.vendorId?.toString();
        const student = await User.findById(o.studentId);
        obj.studentName = student ? student.name : 'Student';
        return obj;
      })
    );

    res.json(populated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

app.put('/orders/:id', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['placed', 'accepted', 'processing', 'ready', 'delivered', 'rejected'];
    if (!validStatuses.includes(status))
      return res.status(400).json({ message: 'Invalid status' });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true }
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    const obj = order.toObject();
    obj._id = obj._id.toString();
    res.json(obj);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating order' });
  }
});

app.delete('/orders/:id', authMiddleware, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: 'Order deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting order' });
  }
});

// ─────────────────────────────────────────────
// 💬 MESSAGES
// ─────────────────────────────────────────────
app.get('/messages', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) return res.status(400).json({ message: 'orderId required' });

    const messages = await Message.find({ orderId }).sort({ createdAt: 1 });

    // ✅ Stringify all ObjectId fields before sending to frontend
    const serialized = messages.map(m => {
      const obj = m.toObject();
      obj._id = obj._id.toString();
      obj.senderId = obj.senderId.toString();
      obj.orderId = obj.orderId.toString();
      return obj;
    });

    res.json(serialized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

app.post('/messages', authMiddleware, async (req, res) => {
  try {
    const { orderId, content } = req.body;
    if (!orderId || !content)
      return res.status(400).json({ message: 'orderId and content are required' });

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const userId = req.user.id.toString();
    const isParticipant =
      order.studentId.toString() === userId ||
      order.vendorId.toString() === userId;

    if (!isParticipant)
      return res.status(403).json({ message: 'Not authorized' });

    const sender = await User.findById(req.user.id);

    const message = new Message({
      orderId,
      senderId: req.user.id,
      senderRole: req.user.role,
      senderName: sender ? sender.name : 'Unknown',
      content,
      isRead: false,
    });

    await message.save();

    // ✅ Serialize to plain object with all ObjectIds as strings
    // This is critical — if senderId is an ObjectId object on the socket event,
    // the frontend's senderId.toString() === userId.toString() will still work,
    // but keeping it consistent as strings everywhere avoids all edge cases.
    const serialized = {
      ...message.toObject(),
      _id: message._id.toString(),
      senderId: message.senderId.toString(),  // ← plain string, not ObjectId
      orderId: message.orderId.toString(),
    };

    // Emit to everyone in the order room (sender + receiver both get it)
    const io = req.app.get('io');
    io.to(orderId).emit('new_message', serialized);

    res.json(serialized);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error sending message' });
  }
});

app.put('/messages/read', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.body;
    await Message.updateMany(
      { orderId, senderId: { $ne: req.user.id } },
      { isRead: true }
    );
    res.json({ message: 'Messages marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error marking messages as read' });
  }
});

// ─────────────────────────────────────────────
// 🚀 START SERVER
// ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} 🚀`);
});
