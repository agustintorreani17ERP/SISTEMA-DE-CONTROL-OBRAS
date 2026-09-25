import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/asyncHandler";
import { ok } from "../../http/respond";
import { DomainError } from "../../errors/domain";

export const authRouter = Router();

export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  role: "ADMIN" | "JEFE_OBRA" | "JEFE_FRENTE" | "COMPRAS" | "GERENCIA";
  roleLabel: string;
  initials: string;
}

const USERS: AuthUser[] = [
  {
    id: 1,
    fullName: "Ana Urbina",
    email: "ana.urbina@obra.local",
    role: "JEFE_OBRA",
    roleLabel: "Jefa de Obra / Administradora",
    initials: "AU",
  },
  {
    id: 2,
    fullName: "Ing. Carlos Benítez",
    email: "cbenitez@obra.local",
    role: "JEFE_FRENTE",
    roleLabel: "Jefe de Frente 1",
    initials: "CB",
  },
  {
    id: 3,
    fullName: "Lic. María Gómez",
    email: "mgomez@obra.local",
    role: "COMPRAS",
    roleLabel: "Responsable de Compras",
    initials: "MG",
  },
];

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

authRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    ok(res, USERS);
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const cleanEmail = email.trim().toLowerCase();

    // Check pre-configured users
    let user = USERS.find((u) => u.email.toLowerCase() === cleanEmail || u.fullName.toLowerCase() === cleanEmail);

    if (!user) {
      // Allow custom email login with credentials
      const namePart = email.includes("@") ? email.split("@")[0] : email;
      const formattedName = namePart.charAt(0).toUpperCase() + namePart.slice(1);
      const initials = formattedName.substring(0, 2).toUpperCase();

      user = {
        id: Date.now(),
        fullName: formattedName,
        email: email.includes("@") ? email : `${email}@obra.local`,
        role: "JEFE_OBRA",
        roleLabel: "Usuario ERP",
        initials: initials || "US",
      };
    }

    ok(res, {
      user,
      token: `token-${user.id}-${Date.now()}`,
      message: `Bienvenido/a, ${user.fullName}`,
    });
  })
);

authRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    // Default user is Ana Urbina (as shown in user screenshots)
    ok(res, USERS[0]);
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    ok(res, { success: true, message: "Sesión cerrada correctamente" });
  })
);
