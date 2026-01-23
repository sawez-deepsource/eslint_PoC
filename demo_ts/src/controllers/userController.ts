import { UserID, ApiResponse } from "../types";
import {
  createUser,
  deactivateUser,
  getUserProfile,
} from "../services/userService";

export async function handleCreateUser(
  req: any,
): Promise<ApiResponse<unknown>> {
  const { id, name, email } = req.body;

  // no-unsafe-assignment / no-unsafe-member-access
  return createUser(id as UserID, name, email);
}

export async function handleDeactivateUser(
  req: any,
): Promise<ApiResponse<unknown>> {
  const { id } = req.params;
  return deactivateUser(id as UserID);
}

export async function handleGetProfile(
  req: any,
): Promise<ApiResponse<unknown>> {
  const { id } = req.params;
  const result = await getUserProfile(id as UserID);

  if (!result.success) {
    return result;
  }

  // strict-boolean-expressions
  if (result.data) {
    return result;
  }

  return { success: false, error: { code: "EMPTY", message: "No data" } };
}
