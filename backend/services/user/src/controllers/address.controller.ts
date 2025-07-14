import { Request, Response, NextFunction } from 'express';
import { AddressService } from '../services/address.service';
import { AppError } from '../middleware/error.middleware';

export class AddressController {
  private addressService = new AddressService();

  getAddresses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const addresses = await this.addressService.getUserAddresses(req.user!.userId);

      res.json({
        data: addresses
      });
    } catch (error) {
      next(error);
    }
  };

  getAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { addressId } = req.params;
      const address = await this.addressService.getAddress(addressId, req.user!.userId);

      res.json({
        data: address
      });
    } catch (error) {
      next(error);
    }
  };

  createAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const address = await this.addressService.createAddress(req.user!.userId, req.body);

      res.status(201).json({
        message: 'Address created successfully',
        data: address
      });
    } catch (error) {
      next(error);
    }
  };

  updateAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { addressId } = req.params;
      const address = await this.addressService.updateAddress(addressId, req.user!.userId, req.body);

      res.json({
        message: 'Address updated successfully',
        data: address
      });
    } catch (error) {
      next(error);
    }
  };

  deleteAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { addressId } = req.params;
      await this.addressService.deleteAddress(addressId, req.user!.userId);

      res.json({
        message: 'Address deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  };

  setDefaultAddress = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { addressId } = req.params;
      await this.addressService.setDefaultAddress(addressId, req.user!.userId);

      res.json({
        message: 'Default address updated successfully'
      });
    } catch (error) {
      next(error);
    }
  };
}