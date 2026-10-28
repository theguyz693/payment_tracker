"use client";

import { createAuthClient } from "better-auth/react";

// No baseURL: calls go to the same origin the app is served from
// (localhost in dev, your domain in production).
export const authClient = createAuthClient();
