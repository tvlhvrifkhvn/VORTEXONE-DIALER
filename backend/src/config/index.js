require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  telephonyProvider: process.env.TELEPHONY_PROVIDER || 'mock',
  smsProvider: process.env.SMS_PROVIDER || 'mock',
  emailProvider: process.env.EMAIL_PROVIDER || 'mock',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  groqApiKey: process.env.GROQ_API_KEY || '',
};
