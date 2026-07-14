const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(process.cwd(), 'server', '.env') });
const express = require('express');
const cors = require('cors');
const routes = require('./server/routes');
const app = express();
app.use(cors());
app.use(express.json());
app.use('/', routes);
app.listen(3100, '127.0.0.1', () => {
  console.log('listening');
});
