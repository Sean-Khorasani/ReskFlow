import { Router } from 'express';
import { AddressController } from '../controllers/address.controller';
import { validate } from '../middleware/validation.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { createAddressSchema, updateAddressSchema } from '../validators/address.validators';

const router = Router();
const addressController = new AddressController();

// All routes require authentication
router.use(authenticate);

router.get('/', addressController.getAddresses);
router.post('/', validate(createAddressSchema), addressController.createAddress);
router.get('/:addressId', addressController.getAddress);
router.patch('/:addressId', validate(updateAddressSchema), addressController.updateAddress);
router.delete('/:addressId', addressController.deleteAddress);
router.patch('/:addressId/default', addressController.setDefaultAddress);

export { router as addressRouter };