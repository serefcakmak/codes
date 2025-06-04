const express = require('express');
const router = express.Router();
const { addItemToCart } = require('../controllers/cartController');

router.post('/item', addItemToCart);

module.exports = router;
