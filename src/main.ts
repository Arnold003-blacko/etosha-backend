import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import morgan from 'morgan';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  // 🔒 SECURITY: Validate critical environment variables on startup
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
  ];
  
  const missingVars = requiredEnvVars.filter(varName => {
    const value = process.env[varName];
    return !value || value === 'replace_this_in_prod' || value === 'replace_staff_secret_in_prod';
  });
  
  if (missingVars.length > 0) {
    console.error('❌ CRITICAL: Missing or invalid environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\n⚠️  Application cannot start without these variables.');
    console.error('   Please set them in your .env file or environment.');
    process.exit(1);
  }
  
  // Warn about weak secrets in production
  if (process.env.NODE_ENV === 'production') {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      console.warn('⚠️  WARNING: JWT_SECRET is shorter than 32 characters. Consider using a stronger secret.');
    }
    if (process.env.STAFF_JWT_SECRET && process.env.STAFF_JWT_SECRET.length < 32) {
      console.warn('⚠️  WARNING: STAFF_JWT_SECRET is shorter than 32 characters. Consider using a stronger secret.');
    }
  }

  const app = await NestFactory.create(AppModule);
  
  // Configure WebSocket adapter for Socket.IO
  // CORS is handled globally below and in gateway decorators
  app.useWebSocketAdapter(new IoAdapter(app));

  /**
   * 👀 HTTP request logging
   * Enhanced logging for Railway debugging
   */
  app.use(morgan('combined', {
    skip: (req) => req.url === '/health' || req.url === '/',
  }));

  // Additional request logging middleware for debugging
  // Only log in development to avoid information disclosure
  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      // Log all POST requests (especially auth endpoints) - DEV ONLY
      if (req.method === 'POST' && (req.url.includes('/login') || req.url.includes('/signup') || req.url.includes('/register'))) {
        console.log(`🔐 [${new Date().toISOString()}] ${req.method} ${req.url}`);
        console.log(`   Origin: ${req.headers.origin || 'No origin header'}`);
        console.log(`   User-Agent: ${req.headers['user-agent'] || 'Unknown'}`);
      }
      next();
    });
  }

  /**
   * 📦 BODY PARSERS
   * PayNow requires urlencoded payloads
   */
  app.use(bodyParser.json({ limit: '10mb' })); // Limit request body size
  app.use(bodyParser.urlencoded({ extended: false, limit: '10mb' }));

  /**
   * ⏱️ REQUEST TIMEOUT MIDDLEWARE
   * Prevents long-running requests from exhausting server resources
   */
  app.use((req, res, next) => {
    // Set timeout to 30 seconds (adjust based on your needs)
    const timeout = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);
    
    req.setTimeout(timeout, () => {
      if (!res.headersSent) {
        res.status(408).json({
          statusCode: 408,
          message: 'Request timeout',
          error: 'Request took too long to process',
        });
      }
    });
    
    next();
  });

  /**
   * 🔐 Global validation
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // Changed to false - log extra properties instead of rejecting
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      exceptionFactory: (errors) => {
        // Recursively extract validation error messages including nested objects
        const extractErrors = (errorList: any[], prefix = ''): string[] => {
          const messages: string[] = [];
          
          errorList.forEach(error => {
            const propertyPath = prefix ? `${prefix}.${error.property}` : error.property;
            
            // If there are constraints (direct validation errors)
            if (error.constraints && Object.keys(error.constraints).length > 0) {
              const constraintMessages = Object.values(error.constraints);
              constraintMessages.forEach((msg: any) => {
                messages.push(`${propertyPath}: ${msg}`);
              });
            }
            
            // If there are nested children (for nested objects like nextOfKinDetails, deceasedDetails)
            if (error.children && error.children.length > 0) {
              const nestedMessages = extractErrors(error.children, propertyPath);
              messages.push(...nestedMessages);
            }
          });
          
          return messages;
        };
        
        const messages = extractErrors(errors);
        
        return new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: messages,
        });
      },
    }),
  );

  /**
   * 🌍 CORS - Configurable origins for security
   * Supports both development (all origins) and production (whitelist)
   */
  const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : (process.env.NODE_ENV === 'production' ? [] : true); // Allow all in dev, none in prod unless specified
  
  app.enableCors({
    origin: corsOrigins, // Use environment variable or allow all in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'Accept', 
      'Origin', 
      'X-Requested-With',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods'
    ],
    exposedHeaders: ['Content-Length', 'Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 86400, // 24 hours
  });
  
  // Log CORS configuration (without exposing sensitive info)
  if (Array.isArray(corsOrigins)) {
    console.log(`🔗 CORS: Whitelisted ${corsOrigins.length} origin(s)`);
  } else {
    console.log(`🔗 CORS: Allowing all origins (development mode)`);
  }

  /**
   * 🚀 Railway-safe port binding
   * Railway provides PORT environment variable automatically
   */
  const port = Number(process.env.PORT) || 8080;
  
  // Log startup information for debugging
  console.log('🚀 Starting NestJS application...');
  console.log(`📡 Port: ${port}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  await app.listen(port, '0.0.0.0');

  console.log(`✅ Application is running on: http://0.0.0.0:${port}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   - POST /auth/login`);
  console.log(`   - POST /auth/register`);
  console.log(`   - POST /members/login`);
  console.log(`   - POST /members/signup`);
}

bootstrap();
