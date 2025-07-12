import bcrypt from 'bcryptjs';
import { generateToken, generateRefreshToken } from '@reskflow/shared';
import { Context } from '../context';
import { GraphQLError } from 'graphql';

interface SignupInput {
  email: string;
  phone: string;
  password: string;
  role?: string;
}

export const authResolvers = {
  Query: {
    me: async (_: unknown, __: unknown, { user, prisma }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');
      
      return prisma.user.findUnique({
        where: { id: user.id },
        include: { profile: true, addresses: true },
      });
    },
  },

  Mutation: {
    signup: async (_: unknown, { input }: { input: SignupInput }, { prisma }: Context) => {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { email: input.email },
            { phone: input.phone },
          ],
        },
      });

      if (existingUser) {
        throw new GraphQLError('User already exists');
      }

      const hashedPassword = await bcrypt.hash(input.password, 10);

      const user = await prisma.user.create({
        data: {
          ...input,
          password: hashedPassword,
          profile: {
            create: {},
          },
        },
        include: { profile: true },
      });

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };

      const token = generateToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      await prisma.session.create({
        data: {
          userId: user.id,
          token,
          refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return { token, refreshToken, user };
    },

    login: async (_: unknown, { email, password }: { email: string; password: string }, { prisma }: Context) => {
      const user = await prisma.user.findUnique({
        where: { email },
        include: { profile: true },
      });

      if (!user) {
        throw new GraphQLError('Invalid credentials');
      }

      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        throw new GraphQLError('Invalid credentials');
      }

      if (!user.isActive) {
        throw new GraphQLError('Account is disabled');
      }

      const tokenPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };

      const token = generateToken(tokenPayload);
      const refreshToken = generateRefreshToken(tokenPayload);

      await prisma.session.create({
        data: {
          userId: user.id,
          token,
          refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      return { token, refreshToken, user };
    },

    refreshToken: async (_: unknown, { refreshToken }: { refreshToken: string }, { prisma }: Context) => {
      const session = await prisma.session.findUnique({
        where: { refreshToken },
        include: { user: { include: { profile: true } } },
      });

      if (!session || session.expiresAt < new Date()) {
        throw new GraphQLError('Invalid refresh token');
      }

      const tokenPayload = {
        userId: session.user.id,
        email: session.user.email,
        role: session.user.role,
      };

      const newToken = generateToken(tokenPayload);
      const newRefreshToken = generateRefreshToken(tokenPayload);

      await prisma.session.update({
        where: { id: session.id },
        data: {
          token: newToken,
          refreshToken: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        token: newToken,
        refreshToken: newRefreshToken,
        user: session.user,
      };
    },

    logout: async (_: unknown, __: unknown, { user, req, prisma, redis }: Context) => {
      if (!user) throw new GraphQLError('Not authenticated');

      const token = req.headers.authorization?.substring(7);
      if (token) {
        await redis.set(`blacklist:token:${token}`, '1', 60 * 60 * 24 * 7);
        
        await prisma.session.deleteMany({
          where: { token },
        });
      }

      return true;
    },
  },
};