import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import morgan from 'morgan';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
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
  app.use((req, res, next) => {
    // Log all POST requests (especially auth endpoints)
    if (req.method === 'POST' && (req.url.includes('/login') || req.url.includes('/signup') || req.url.includes('/register'))) {
      console.log(`🔐 [${new Date().toISOString()}] ${req.method} ${req.url}`);
      console.log(`   Origin: ${req.headers.origin || 'No origin header'}`);
      console.log(`   User-Agent: ${req.headers['user-agent'] || 'Unknown'}`);
    }
    next();
  });

  /**
   * 📦 BODY PARSERS
   * PayNow requires urlencoded payloads
   */
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));

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
        // Custom error messages for better debugging
        const messages = errors.map(error => {
          const constraints = Object.values(error.constraints || {});
          return `${error.property}: ${constraints.join(', ')}`;
        });
        return new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: messages,
        });
      },
    }),
  );

  /**
   * 🌍 CORS - Allow all origins for Railway deployment
   * Railway deployments require proper CORS configuration
   */
  app.enableCors({
    origin: true, // Allow all origins - Railway frontend can come from different domains
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

  /**
   * 🚀 Railway-safe port binding
   * Railway provides PORT environment variable automatically
   */
  const port = Number(process.env.PORT) || 8080;
  
  // Log startup information for debugging
  console.log('🚀 Starting NestJS application...');
  console.log(`📡 Port: ${port}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 CORS: Enabled (allowing all origins)`);
  
  await app.listen(port, '0.0.0.0');

  console.log(`✅ Application is running on: http://0.0.0.0:${port}`);
  console.log(`📋 Available endpoints:`);
  console.log(`   - POST /auth/login`);
  console.log(`   - POST /auth/register`);
  console.log(`   - POST /members/login`);
  console.log(`   - POST /members/signup`);
}

bootstrap();
