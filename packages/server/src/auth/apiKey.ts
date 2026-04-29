import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Database } from '@qunkins/core';

export type UserRole = 'admin' | 'developer';

export interface AuthenticatedUser {
  id: string;
  username: string;
  role: UserRole;
  email?: string | null;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser | null;
}

export function validateApiKey(apiKey: string, db: Database): boolean {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const user = db.getUserByApiKey(hash);
  return !!user;
}

export function requireApiKey(authHeader: string, db: Database): string {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header. Expected: Bearer <api-key>');
  }
  
  const apiKey = authHeader.slice(7);
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const user = db.getUserByApiKey(hash);
  
  if (!user) {
    throw new Error('Invalid API key');
  }
  
  return user.id;
}

export function getUserByApiKey(authHeader: string, db: Database): AuthenticatedUser {
  const userId = requireApiKey(authHeader, db);
  const user = db.getUser(userId) as AuthenticatedUser;

  if (!user) {
    throw new Error('Invalid API key');
  }

  if (user.role !== 'admin' && user.role !== 'developer') {
    throw new Error('Unknown user role');
  }

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    email: user.email
  };
}

function hasRole(userRole: UserRole, allowedRoles: UserRole[]): boolean {
  if (!userRole || !allowedRoles.length) {
    return false;
  }

  if (userRole === 'admin') {
    return true;
  }

  return allowedRoles.includes('developer');
}

export function createAuthMiddleware(
  dbPath: string,
  allowedRoles: UserRole[] = ['admin', 'developer']
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.QUNKINS_AUTH_ENABLED === 'false') {
      (req as RequestWithUser).user = {
        id: 'local-anonymous',
        username: 'local',
        role: 'admin'
      };
      next();
      return;
    }

    const db = new Database(dbPath);
    try {
      const user = getUserByApiKey(req.headers.authorization as string, db);
      if (!hasRole(user.role, allowedRoles)) {
        res.status(403).json({ error: 'Forbidden: insufficient role' });
        return;
      }
      (req as RequestWithUser).user = user;
      next();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid request';
      res.status(401).json({ error: message });
    } finally {
      db.close();
    }
  };
}

export function generateApiKey(): { key: string; hash: string } {
  const key = `qk_${crypto.randomBytes(16).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, hash };
}
