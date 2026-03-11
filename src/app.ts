import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import logger from './utils/logger';
import apiRoutes from './routes';

class App {
  public app: Application;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Security
    this.app.use(helmet());

    // CORS
    this.app.use(
      cors({
        origin: config.frontendUrl,
        credentials: true,
      })
    );

    // Compression
    this.app.use(compression());

    // Body parsers
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // HTTP request logger
    if (config.env === 'development') {
      this.app.use(morgan('dev'));
    } else {
      this.app.use(morgan('combined', {
        stream: {
          write: (message: string) => logger.info(message.trim()),
        },
      }));
    }

    // Rate limiting with more lenient settings
    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.max,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      // Skip rate limiting for certain conditions
      skip: (req: Request) => {
        // Skip rate limiting in development for localhost
        if (config.env === 'development' && 
            (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1')) {
          return true;
        }
        return false;
      },
      // Handler for when rate limit is exceeded
      handler: (req: Request, res: Response) => {
        logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
        res.status(429).json({
          success: false,
          error: 'Too many requests, please try again later.',
          retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
        });
      },
    });
    this.app.use('/api/', limiter);
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        data: {
          message: 'Server is running',
          timestamp: new Date().toISOString(),
        },
      });
    });

    // API routes
    this.app.get('/api', (_req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        data: {
          message: 'ATS API',
          version: config.apiVersion,
          documentation: '/api/docs',
        },
      });
    });

    // Mount API routes
    this.app.use('/api', apiRoutes);

    // 404 handler
    this.app.use((req: Request, res: Response) => {
      res.status(404).json({
        success: false,
        error: {
          message: 'Route not found',
          path: req.path,
        },
      });
    });
  }

  private setupErrorHandling(): void {
    // Global error handler
    this.app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      logger.error('Error:', {
        message: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
      });

      // Mongoose validation error
      if (err.name === 'ValidationError') {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Validation error',
            errors: Object.values(err.errors).map((e: any) => e.message),
          },
        });
      }

      // Mongoose duplicate key error
      if (err.code === 11000) {
        const field = Object.keys(err.keyPattern)[0];
        return res.status(409).json({
          success: false,
          error: {
            message: `Duplicate value for field: ${field}`,
          },
        });
      }

      // JWT errors
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Invalid token',
          },
        });
      }

      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: {
            message: 'Token expired',
          },
        });
      }

      // Default error
      const statusCode = err.statusCode || 500;
      const message = err.message || 'Internal server error';

      return res.status(statusCode).json({
        success: false,
        error: {
          message,
          ...(config.env === 'development' && { stack: err.stack }),
        },
      });
    });
  }
}

export default new App().app;
