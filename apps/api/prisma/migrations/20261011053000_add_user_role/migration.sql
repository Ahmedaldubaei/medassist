-- Add USER as the least-privilege default role for self-registered users (P6 security fix).
ALTER TYPE "Role" ADD VALUE 'USER';
