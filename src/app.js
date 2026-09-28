const express = require('express');
const dispositionLeadRoutes = require('./routes/dispositionLeadRoutes');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/disposition-leads', dispositionLeadRoutes);
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    });
  });
  app.use(errorHandler);
  return app;
}

module.exports = {
  createApp,
};
