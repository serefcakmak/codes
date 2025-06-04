const { addCartItemService } = require('../services/cartService');

async function addItemToCart(req, res) {
  try {
    const result = await addCartItemService(req.body);
    res.json({ success: true, message: result });
  } catch (error) {
    console.error("Ürün ekleme hatası:", error);
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { addItemToCart };
