import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommissionDto } from './dto/create-commission.dto';
import { ApproveCommissionDto } from './dto/approve-commission.dto';
import { CommissionStatus, PricingSection } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class CommissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a commission for a purchase
   * Commission is 10% of the purchase totalAmount
   */
  async createCommission(dto: CreateCommissionDto) {
    // Get purchase details
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: dto.purchaseId },
      select: {
        id: true,
        totalAmount: true,
        createdAt: true,
        product: {
          select: {
            pricingSection: true,
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    // Check if commission already exists for this purchase
    const existingCommission = await this.prisma.commission.findUnique({
      where: { purchaseId: dto.purchaseId },
    });

    if (existingCommission) {
      throw new BadRequestException('Commission already exists for this purchase');
    }

    // Calculate commission (10% of totalAmount)
    const commissionAmount = new Decimal(purchase.totalAmount.toString())
      .mul(new Decimal('0.10'))
      .toDecimalPlaces(2);

    // Create commission
    return this.prisma.commission.create({
      data: {
        purchaseId: dto.purchaseId,
        agentName: dto.agentName,
        company: dto.company,
        agentStaffId: dto.agentStaffId,
        saleDate: purchase.createdAt,
        section: purchase.product.pricingSection,
        commissionAmount,
        status: CommissionStatus.PENDING,
      },
      include: {
        purchase: {
          select: {
            id: true,
            totalAmount: true,
            createdAt: true,
            product: {
              select: {
                title: true,
                pricingSection: true,
              },
            },
          },
        },
        agentStaff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Get all commissions with filtering and pagination
   */
  async getCommissions(
    page: number = 1,
    limit: number = 50,
    status?: CommissionStatus,
    company?: string,
    agentStaffId?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (status) where.status = status;
    if (company) where.company = company;
    if (agentStaffId) where.agentStaffId = agentStaffId;

    const [commissions, total] = await Promise.all([
      this.prisma.commission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { saleDate: 'desc' },
        select: {
          id: true,
          purchaseId: true,
          agentName: true,
          company: true,
          saleDate: true,
          section: true,
          commissionAmount: true,
          status: true,
          approvedBy: true,
          approvedAt: true,
          createdAt: true,
          updatedAt: true,
          purchase: {
            select: {
              id: true,
              totalAmount: true,
              createdAt: true,
              product: {
                select: {
                  title: true,
                  pricingSection: true,
                },
              },
            },
          },
          agentStaff: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.commission.count({ where }),
    ]);

    return {
      commissions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get commission by ID
   */
  async getCommissionById(id: string) {
    const commission = await this.prisma.commission.findUnique({
      where: { id },
      select: {
        id: true,
        purchaseId: true,
        agentName: true,
        company: true,
        saleDate: true,
        section: true,
        commissionAmount: true,
        status: true,
        approvedBy: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
        purchase: {
          select: {
            id: true,
            totalAmount: true,
            createdAt: true,
            product: {
              select: {
                title: true,
                pricingSection: true,
              },
            },
          },
        },
        agentStaff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        approver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (!commission) {
      throw new NotFoundException('Commission not found');
    }

    return commission;
  }

  /**
   * Approve and issue a commission (Level 3+ only)
   */
  async approveCommission(dto: ApproveCommissionDto, approverId: string, approverLevel: number) {
    // Check if approver has Level 3 or above
    if (approverLevel < 3) {
      throw new ForbiddenException('Only Level 3 and above staff can approve commissions');
    }

    const commission = await this.prisma.commission.findUnique({
      where: { id: dto.commissionId },
    });

    if (!commission) {
      throw new NotFoundException('Commission not found');
    }

    if (commission.status === CommissionStatus.ISSUED) {
      throw new BadRequestException('Commission has already been issued');
    }

    return this.prisma.commission.update({
      where: { id: dto.commissionId },
      data: {
        status: CommissionStatus.ISSUED,
        approvedBy: approverId,
        approvedAt: new Date(),
      },
      include: {
        purchase: {
          select: {
            id: true,
            totalAmount: true,
            createdAt: true,
            product: {
              select: {
                title: true,
                pricingSection: true,
              },
            },
          },
        },
        agentStaff: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        approver: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }
}
