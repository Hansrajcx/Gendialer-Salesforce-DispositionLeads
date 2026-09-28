const express = require('express');
const controller = require('../controllers/dispositionLeadController');

const router = express.Router();

router.post('/', controller.create);
router.patch('/:id', controller.update);
router.get('/', controller.list);

module.exports = router;
