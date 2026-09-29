const express = require('express');
const cors = require('cors');
const dispositionLeadRoutes = require('./routes/dispositionLeadRoutes');
const errorHandler = require('./middleware/errorHandler');

// function createApp() {
//   const app = express();
//   app.use(cors({
//     origin(origin, callback) {
//       const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
//         .split(',')
//         .map((value) => value.trim())
//         .filter(Boolean);
//       callback(null, !origin || allowedOrigins.includes(origin));
//     },
//     methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning',*],
//     optionsSuccessStatus: 204,
//   }));
//   app.use(express.json());
//   app.use('/api/disposition-leads', dispositionLeadRoutes);
//   app.use((req, res) => {
//     res.status(404).json({
//       success: false,
//       error: {
//         code: 'NOT_FOUND',
//         message: 'Resource not found',
//       },
//     });
//   });
//   app.use(errorHandler);
//   return app;
// }

function createApp() {
  const app = express();

  app.use(
    cors({
      origin: true,
      methods: '*',
      allowedHeaders: '*',
      optionsSuccessStatus: 204,
    })
  );

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
