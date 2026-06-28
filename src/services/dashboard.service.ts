import { DashboardModel } from '../models/dashboard.model.js';

export class DashboardService {
  static async health() {
    await DashboardModel.healthCheck();
    return { status: 'ok' };
  }

  static async stats() {
    return DashboardModel.stats();
  }
}
