import { prisma } from "../prisma.js";

/**
 * 家庭数据隔离守卫：所有按孩子维度的读写前都要先确认该孩子属于当前家庭，
 * 避免调用方传入或猜测其他家庭的 child_id。
 */
export async function assertChildInFamily(familyId: string, childId: string) {
  const child = await prisma.child.findFirst({ where: { id: childId, familyId } });
  if (!child) {
    // 404 而不是 500：调用方传了不属于本家庭（或不存在）的 child_id，属于客户端错误。
    const error = new Error("学生不存在或不属于当前家庭") as Error & { statusCode: number };
    error.statusCode = 404;
    throw error;
  }
  return child;
}
