declare module "express-serve-static-core" {
    interface Request {
      user?: {
        id: string;
        username: string;
      };
    }
  }
  export {};