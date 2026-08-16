import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller.js';
import { asyncHandler } from '../errors.js';

export const paymentsRouter = Router();

paymentsRouter.get('/', asyncHandler(PaymentController.list));
paymentsRouter.post('/', asyncHandler(PaymentController.create));
paymentsRouter.patch('/:id', asyncHandler(PaymentController.update));
paymentsRouter.delete('/:id', asyncHandler(PaymentController.delete));
