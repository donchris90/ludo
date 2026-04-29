// src/models/db.ts
import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

export const sequelize = new Sequelize(process.env.DATABASE_URL!, {
  dialect: 'postgres',
  logging: false,
  pool: { max: 10, min: 2, acquire: 30000, idle: 10000 },
});

// ─── USER ─────────────────────────────────────────────────────────────────────
export class User extends Model {}
User.init({
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  username:     { type: DataTypes.STRING(30), allowNull: false, unique: true },
  email:        { type: DataTypes.STRING, allowNull: false, unique: true },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  phone:        { type: DataTypes.STRING, allowNull: true },
  avatarUrl:    { type: DataTypes.STRING, allowNull: true },
  elo:          { type: DataTypes.INTEGER, defaultValue: 1000 },
  totalWins:    { type: DataTypes.INTEGER, defaultValue: 0 },
  totalGames:   { type: DataTypes.INTEGER, defaultValue: 0 },
  isVerified:   { type: DataTypes.BOOLEAN, defaultValue: false },
  isBanned:     { type: DataTypes.BOOLEAN, defaultValue: false },
  referralCode: { type: DataTypes.STRING(10), unique: true },
  referredBy:   { type: DataTypes.UUID, allowNull: true },
  country:      { type: DataTypes.STRING(3), defaultValue: 'NGA' },
}, { sequelize, modelName: 'User', tableName: 'users' });

// ─── WALLET ───────────────────────────────────────────────────────────────────
export class Wallet extends Model {}
Wallet.init({
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:       { type: DataTypes.UUID, allowNull: false, references: { model: 'users', key: 'id' } },
  nairaBalance: { type: DataTypes.DECIMAL(15, 2), defaultValue: 0 },
  usdtBalance:  { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
  usdcBalance:  { type: DataTypes.DECIMAL(20, 6), defaultValue: 0 },
  btcBalance:   { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
  coinBalance:  { type: DataTypes.BIGINT, defaultValue: 1000 },
  ethAddress:   { type: DataTypes.STRING, allowNull: true },
  btcAddress:   { type: DataTypes.STRING, allowNull: true },
}, { sequelize, modelName: 'Wallet', tableName: 'wallets' });

// ─── TRANSACTION ──────────────────────────────────────────────────────────────
export class Transaction extends Model {}
Transaction.init({
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:    { type: DataTypes.UUID, allowNull: false },
  type:      {
    type: DataTypes.ENUM(
      'deposit', 'withdrawal', 'stake', 'prize', 'referral', 'coin_purchase', 'coin_earn'
    ),
    allowNull: false,
  },
  currency:  { type: DataTypes.ENUM('NGN', 'USDT', 'USDC', 'BTC', 'COIN'), allowNull: false },
  amount:    { type: DataTypes.DECIMAL(20, 8), allowNull: false },
  fee:       { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
  status:    { type: DataTypes.ENUM('pending', 'confirmed', 'failed', 'reversed'), defaultValue: 'pending' },
  reference: { type: DataTypes.STRING, unique: true },
  metadata:  { type: DataTypes.JSONB, defaultValue: {} },
  gameId:    { type: DataTypes.UUID, allowNull: true },
}, { sequelize, modelName: 'Transaction', tableName: 'transactions' });

// ─── GAME ─────────────────────────────────────────────────────────────────────
export class Game extends Model {}
Game.init({
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  mode:          { type: DataTypes.ENUM('casual', 'real_money'), allowNull: false },
  status:        { type: DataTypes.ENUM('waiting', 'in_progress', 'completed', 'cancelled'), defaultValue: 'waiting' },
  playerCount:   { type: DataTypes.INTEGER, defaultValue: 4 },
  stakeAmount:   { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
  stakeCurrency: { type: DataTypes.ENUM('NGN', 'USDT', 'USDC', 'BTC', 'COIN'), defaultValue: 'COIN' },
  potAmount:     { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
  platformFee:   { type: DataTypes.DECIMAL(5, 2), defaultValue: 10 },
  winnerId:      { type: DataTypes.UUID, allowNull: true },
  slots:         { type: DataTypes.JSONB, defaultValue: [] },
  gameState:     { type: DataTypes.JSONB, defaultValue: {} },
  startedAt:     { type: DataTypes.DATE, allowNull: true },
  endedAt:       { type: DataTypes.DATE, allowNull: true },
  tournamentId:  { type: DataTypes.UUID, allowNull: true },
}, { sequelize, modelName: 'Game', tableName: 'games' });

// ─── DAILY CLAIM ──────────────────────────────────────────────────────────────
export class DailyClaim extends Model {}
DailyClaim.init({
  id:              { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  userId:          { type: DataTypes.UUID, allowNull: false },
  date:            { type: DataTypes.DATEONLY, allowNull: false },
  loginClaimed:    { type: DataTypes.BOOLEAN, defaultValue: false },
  firstWinClaimed: { type: DataTypes.BOOLEAN, defaultValue: false },
  adsWatched:      { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  sequelize, modelName: 'DailyClaim', tableName: 'daily_claims',
  indexes: [{ unique: true, fields: ['userId', 'date'] }],
});

// ─── TOURNAMENT ───────────────────────────────────────────────────────────────
export class Tournament extends Model {}
Tournament.init({
  id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:           { type: DataTypes.STRING, allowNull: false },
  entryFee:       { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
  currency:       { type: DataTypes.ENUM('NGN', 'USDT', 'USDC', 'BTC', 'COIN'), defaultValue: 'COIN' },
  prizePool:      { type: DataTypes.DECIMAL(20, 8), defaultValue: 0 },
  maxPlayers:     { type: DataTypes.INTEGER, defaultValue: 16 },
  status:         { type: DataTypes.ENUM('upcoming', 'registering', 'in_progress', 'completed'), defaultValue: 'upcoming' },
  startTime:      { type: DataTypes.DATE, allowNull: false },
  bracket:        { type: DataTypes.JSONB, defaultValue: {} },
  prizeStructure: { type: DataTypes.JSONB, defaultValue: { 1: 0.5, 2: 0.3, 3: 0.2 } },
}, { sequelize, modelName: 'Tournament', tableName: 'tournaments' });

// ─── ASSOCIATIONS ─────────────────────────────────────────────────────────────
User.hasOne(Wallet, { foreignKey: 'userId', as: 'wallet' });
Wallet.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Transaction, { foreignKey: 'userId' });
User.hasMany(DailyClaim, { foreignKey: 'userId' });
User.hasMany(Game, { foreignKey: 'winnerId', as: 'wonGames' });
Game.belongsTo(User, { foreignKey: 'winnerId', as: 'winner' });

// ─── INITIALIZATION FUNCTION ──────────────────────────────────────────────────
export async function initDB() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');

    await sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
    console.log('✅ Database synchronized');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export default {
  sequelize,
  User,
  Wallet,
  Transaction,
  Game,
  DailyClaim,
  Tournament,
  initDB,
};