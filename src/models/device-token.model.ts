import { prisma } from '../prisma.js';

export type DeviceRole = 'parent' | 'driver';

export class DeviceTokenModel {
  static async upsert(phone: string, role: DeviceRole, token: string, platform: string) {
    return prisma.deviceToken.upsert({
      where: { token },
      create: { phone, role, token, platform },
      update: { phone, role, platform }
    });
  }

  static async tokensForPhones(phones: string[]) {
    if (!phones.length) return [];
    const rows = await prisma.deviceToken.findMany({
      where: { phone: { in: phones } },
      select: { token: true }
    });
    return rows.map(row => row.token);
  }

  static async deleteTokens(tokens: string[]) {
    if (!tokens.length) return;
    await prisma.deviceToken.deleteMany({ where: { token: { in: tokens } } });
  }
}
