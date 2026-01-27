import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardGateway } from '../dashboard/dashboard.gateway';
import { CreateBurialDto } from './dto/create-burial.dto';
import { CreateWaiverDto } from './dto/create-waiver.dto';
import { ApproveWaiverDto } from './dto/approve-waiver.dto';
import { CreateAssignmentRequestDto } from './dto/create-assignment-request.dto';
import { AssignGraveDto } from './dto/assign-grave.dto';
import { UpdateDeceasedDto } from './dto/update-deceased.dto';
import {
  PurchaseStatus,
  BurialStatus,
  WaiverStatus,
  PricingSection,
  AssignmentRequestStatus,
} from '@prisma/client';

@Injectable()
export class BurialsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DashboardGateway))
    private readonly dashboardGateway: DashboardGateway,
  ) {}

  /**
   * Create a burial (staff-only)
   * Supports both paid purchase and waiver paths
   */
  async createBurial(dto: CreateBurialDto, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Validate path
      if (dto.purchaseId && (dto.waiverType || dto.waiverReason)) {
        throw new BadRequestException(
          'Cannot specify both purchase and waiver for the same burial',
        );
      }

      if (!dto.purchaseId && !dto.waiverType) {
        throw new BadRequestException(
          'Must specify either purchaseId or waiverType',
        );
      }

      let status: BurialStatus = BurialStatus.PENDING_GRAVE_ASSIGNMENT;

      // Path A: Paid Purchase Burial
      if (dto.purchaseId) {
        const purchase = await tx.purchase.findUnique({
          where: { id: dto.purchaseId },
          include: { deceased: true, graveSlot: true },
        });

        if (!purchase) {
          throw new NotFoundException('Purchase not found');
        }

        if (purchase.status !== PurchaseStatus.PAID) {
          throw new BadRequestException(
            'Purchase must be fully paid before creating burial',
          );
        }

        if (purchase.deceased) {
          throw new BadRequestException(
            'Purchase already has a deceased record',
          );
        }

        if (purchase.graveSlot) {
          throw new BadRequestException(
            'Purchase is already linked to a grave slot',
          );
        }
      } else {
        // Path B: Waiver/Donation Burial
        status = BurialStatus.PENDING_WAIVER_APPROVAL;
      }

      // Create deceased record
      const deceased = await tx.deceased.create({
        data: {
          purchaseId: dto.purchaseId || null,
          fullName: dto.fullName,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          gender: dto.gender,
          address: dto.address,
          relationship: dto.relationship,
          causeOfDeath: dto.causeOfDeath || null,
          funeralParlor: dto.funeralParlor || null,
          dateOfDeath: new Date(dto.dateOfDeath),
          expectedBurial: dto.expectedBurial
            ? new Date(dto.expectedBurial)
            : null,
          burialDate: dto.burialDate ? new Date(dto.burialDate) : null,
          notes: dto.notes || null,
          status,
          createdBy: staffId,
        },
      });

      // Create next of kin
      await tx.burialNextOfKin.create({
        data: {
          deceasedId: deceased.id,
          fullName: dto.nextOfKinFullName,
          relationship: dto.nextOfKinRelationship,
          phone: dto.nextOfKinPhone,
          email: dto.nextOfKinEmail || null,
          address: dto.nextOfKinAddress,
          isBuyer: dto.isBuyerNextOfKin,
        },
      });

      // Create waiver if needed
      if (dto.waiverType) {
        await tx.waiver.create({
          data: {
            deceasedId: deceased.id,
            waiverType: dto.waiverType,
            reason: dto.waiverReason || '',
            status: WaiverStatus.PENDING,
          },
        });
      }

      // If grave assignment provided, assign it (section will be derived from product)
      if (dto.graveNumber && dto.slotNo) {
        await this.assignGraveInternal(
          {
            deceasedId: deceased.id,
            graveNumber: dto.graveNumber,
            slotNo: parseInt(dto.slotNo),
          },
          staffId,
          tx,
        );
      }

      this.dashboardGateway.broadcastDashboardUpdate();

      return tx.deceased.findUnique({
        where: { id: deceased.id },
        include: {
          purchase: {
            include: {
              member: true,
              product: {
                select: {
                  id: true,
                  title: true,
                  pricingSection: true,
                  amount: true,
                },
              },
            },
          },
          waiver: true,
          graveSlot: {
            include: {
              grave: true,
            },
          },
          nextOfKin: true,
        },
      });
    });
  }

  /**
   * Get deceased register (all deceased records)
   */
  async getDeceasedRegister(
    page: number = 1,
    limit: number = 50,
    search?: string,
    status?: BurialStatus,
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { address: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    const [deceased, total] = await Promise.all([
      this.prisma.deceased.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          purchase: {
            include: {
              member: true,
              product: {
                select: {
                  id: true,
                  title: true,
                  pricingSection: true,
                  amount: true,
                },
              },
            },
          },
          waiver: true,
          graveSlot: {
            include: {
              grave: true,
            },
          },
          nextOfKin: true,
        },
      }),
      this.prisma.deceased.count({ where }),
    ]);

    return {
      data: deceased,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get deceased by ID (for file modal)
   * Optimized to fetch only essential data
   */
  async getDeceasedById(id: string) {
    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new BadRequestException('Invalid deceased ID: must be a valid UUID format');
    }

    const deceased = await this.prisma.deceased.findUnique({
      where: { id },
      select: {
        id: true,
        purchaseId: true,
        fullName: true,
        dateOfBirth: true,
        gender: true,
        address: true,
        relationship: true,
        causeOfDeath: true,
        funeralParlor: true,
        dateOfDeath: true,
        expectedBurial: true,
        burialDate: true,
        notes: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        purchase: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            paidAmount: true,
            member: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            product: {
              select: {
                id: true,
                title: true,
                pricingSection: true,
                amount: true,
              },
            },
            // Only get recent payments (last 5) for performance
            payments: {
              select: {
                id: true,
                amount: true,
                status: true,
                method: true,
                createdAt: true,
                paidAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
        },
        waiver: {
          select: {
            id: true,
            waiverType: true,
            reason: true,
            status: true,
            approvedBy: true,
            approvedAt: true,
            rejectedBy: true,
            rejectedAt: true,
            rejectionReason: true,
          },
        },
        graveSlot: {
          select: {
            id: true,
            slotNo: true,
            priceAtPurchase: true,
            grave: {
              select: {
                id: true,
                section: true,
                graveNumber: true,
                capacity: true,
              },
            },
          },
        },
        nextOfKin: {
          select: {
            id: true,
            fullName: true,
            relationship: true,
            phone: true,
            email: true,
            address: true,
            isBuyer: true,
          },
        },
        // Only get recent assignment requests (last 3) for performance
        assignmentRequests: {
          select: {
            id: true,
            requestedSection: true,
            status: true,
            requestedBy: true,
            assignedBy: true,
            assignedAt: true,
            notes: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
      },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased record not found');
    }

    return deceased;
  }

  /**
   * Get burial calendar (burials by date)
   */
  async getBurialCalendar(startDate: Date, endDate: Date) {
    const burials = await this.prisma.deceased.findMany({
      where: {
        OR: [
          { burialDate: { gte: startDate, lte: endDate } },
          { expectedBurial: { gte: startDate, lte: endDate } },
        ],
        status: {
          not: BurialStatus.PENDING_WAIVER_APPROVAL, // Only show confirmed burials
        },
      },
      include: {
        purchase: {
          include: {
            member: true,
            product: true,
          },
        },
        waiver: true,
        graveSlot: {
          include: {
            grave: true,
          },
        },
        nextOfKin: true,
      },
      orderBy: [
        { burialDate: 'asc' },
        { expectedBurial: 'asc' },
      ],
    });

    // Group by date
    const calendar: Record<string, typeof burials> = {};
    burials.forEach((burial) => {
      const date = burial.burialDate || burial.expectedBurial;
      if (date) {
        // Normalize date to avoid timezone issues - use UTC date components
        const dateObj = new Date(date);
        const year = dateObj.getUTCFullYear();
        const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dateObj.getUTCDate()).padStart(2, '0');
        const dateKey = `${year}-${month}-${day}`;
        if (!calendar[dateKey]) {
          calendar[dateKey] = [];
        }
        calendar[dateKey].push(burial);
      }
    });

    return calendar;
  }

  /**
   * Create waiver (for waiver burials)
   */
  async createWaiver(dto: CreateWaiverDto) {
    const deceased = await this.prisma.deceased.findUnique({
      where: { id: dto.deceasedId },
      include: { waiver: true },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased record not found');
    }

    if (deceased.waiver) {
      throw new BadRequestException('Waiver already exists for this deceased');
    }

    if (deceased.purchaseId) {
      throw new BadRequestException(
        'Cannot create waiver for purchase-funded burial',
      );
    }

    return this.prisma.waiver.create({
      data: {
        deceasedId: dto.deceasedId,
        waiverType: dto.waiverType,
        reason: dto.reason,
        status: WaiverStatus.PENDING,
      },
    });
  }

  /**
   * Get waivers (optionally filtered by status)
   */
  async getWaivers(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status as WaiverStatus;
    }

    return this.prisma.waiver.findMany({
      where,
      include: {
        deceased: {
          select: {
            id: true,
            fullName: true,
            dateOfDeath: true,
            expectedBurial: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve or reject waiver (Level 5 only)
   */
  async approveWaiver(dto: ApproveWaiverDto, staffId: string, staffLevel: number) {
    if (staffLevel < 5) {
      throw new ForbiddenException('Only Level 5 staff can approve waivers');
    }

    return this.prisma.$transaction(async (tx) => {
      const waiver = await tx.waiver.findUnique({
        where: { id: dto.waiverId },
        include: { deceased: true },
      });

      if (!waiver) {
        throw new NotFoundException('Waiver not found');
      }

      if (waiver.status !== WaiverStatus.PENDING) {
        throw new BadRequestException('Waiver is not pending');
      }

      const updateData: any = {
        status: dto.status,
      };

      if (dto.status === WaiverStatus.APPROVED) {
        updateData.approvedBy = staffId;
        updateData.approvedAt = new Date();
      } else if (dto.status === WaiverStatus.REJECTED) {
        updateData.rejectedBy = staffId;
        updateData.rejectedAt = new Date();
        updateData.rejectionReason = dto.rejectionReason || null;
      }

      await tx.waiver.update({
        where: { id: dto.waiverId },
        data: updateData,
      });

      // If approved, update deceased status
      if (dto.status === WaiverStatus.APPROVED) {
        await tx.deceased.update({
          where: { id: waiver.deceasedId },
          data: {
            status: BurialStatus.PENDING_GRAVE_ASSIGNMENT,
          },
        });
      }

      this.dashboardGateway.broadcastDashboardUpdate();

      return tx.waiver.findUnique({
        where: { id: dto.waiverId },
        include: { deceased: true },
      });
    });
  }

  /**
   * Create assignment request
   */
  async createAssignmentRequest(
    dto: CreateAssignmentRequestDto,
    staffId: string,
  ) {
    const deceased = await this.prisma.deceased.findUnique({
      where: { id: dto.deceasedId },
      include: { graveSlot: true },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased record not found');
    }

    if (deceased.graveSlot) {
      throw new BadRequestException('Grave already assigned');
    }

    if (deceased.status === BurialStatus.PENDING_WAIVER_APPROVAL) {
      throw new BadRequestException(
        'Cannot create assignment request for pending waiver',
      );
    }

    return this.prisma.assignmentRequest.create({
      data: {
        deceasedId: dto.deceasedId,
        requestedSection: dto.requestedSection || null,
        status: AssignmentRequestStatus.PENDING,
        requestedBy: staffId,
        notes: dto.notes || null,
      },
    });
  }

  /**
   * Get assignment requests queue
   */
  async getAssignmentRequests(status?: AssignmentRequestStatus) {
    const where: any = {};
    if (status) {
      where.status = status;
    }

    return this.prisma.assignmentRequest.findMany({
      where,
      include: {
        deceased: {
          include: {
            purchase: {
              include: {
                member: true,
                product: {
                  select: {
                    id: true,
                    title: true,
                    pricingSection: true,
                    amount: true,
                  },
                },
              },
            },
            waiver: true,
            nextOfKin: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Assign grave (site operations)
   */
  async assignGrave(dto: AssignGraveDto, staffId: string) {
    return this.prisma.$transaction(async (tx) => {
      return this.assignGraveInternal(dto, staffId, tx);
    });
  }

  /**
   * Internal grave assignment logic
   */
  private async assignGraveInternal(
    dto: AssignGraveDto,
    staffId: string,
    tx: any,
  ) {
    const deceased = await tx.deceased.findUnique({
      where: { id: dto.deceasedId },
      include: {
        graveSlot: true,
        purchase: {
          include: {
            product: true,
          },
        },
        waiver: true,
      },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased record not found');
    }

    if (deceased.graveSlot) {
      throw new BadRequestException('Grave already assigned');
    }

    // Check waiver approval if waiver burial
    if (deceased.waiver && deceased.waiver.status !== WaiverStatus.APPROVED) {
      throw new BadRequestException('Waiver must be approved before assignment');
    }

    // Get section from purchase product (for paid purchases) or use requested section (for waivers)
    let section: PricingSection;
    
    if (deceased.purchaseId && deceased.purchase?.product?.pricingSection) {
      // Section comes from the product that was purchased
      section = deceased.purchase.product.pricingSection;
    } else if (deceased.waiver) {
      // For waiver burials, we need to get section from assignment request or allow it to be specified
      // For now, we'll require it to be in the assignment request or throw an error
      const assignmentRequest = await tx.assignmentRequest.findFirst({
        where: {
          deceasedId: dto.deceasedId,
          status: AssignmentRequestStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!assignmentRequest || !assignmentRequest.requestedSection) {
        throw new BadRequestException(
          'Section must be specified in assignment request for waiver burials',
        );
      }

      section = assignmentRequest.requestedSection;
    } else {
      throw new BadRequestException(
        'Cannot determine section: purchase or waiver information missing',
      );
    }

    // Find or create grave
    let grave = await tx.grave.findUnique({
      where: {
        section_graveNumber: {
          section: section,
          graveNumber: dto.graveNumber,
        },
      },
      include: {
        slots: {
          include: {
            deceased: true,
          },
        },
      },
    });

    if (!grave) {
      grave = await tx.grave.create({
        data: {
          section: section,
          graveNumber: dto.graveNumber,
          capacity: 2,
        },
        include: {
          slots: true,
        },
      });
    }

    // Check if slot is available
    const existingSlot = grave.slots.find((s: any) => s.slotNo === dto.slotNo);
    if (existingSlot && existingSlot.deceased) {
      throw new BadRequestException(
        `Slot ${dto.slotNo} in grave ${dto.graveNumber} is already occupied`,
      );
    }

    // Check purchase uniqueness
    if (deceased.purchaseId) {
      const existingPurchaseSlot = await tx.graveSlot.findUnique({
        where: { purchaseId: deceased.purchaseId },
      });

      if (existingPurchaseSlot) {
        throw new BadRequestException(
          'Purchase is already linked to a grave slot',
        );
      }
    }

    // Calculate price for audit
    let priceAtPurchase: any = null;
    if (deceased.purchaseId && deceased.purchase) {
      priceAtPurchase = deceased.purchase.totalAmount;
      // Slot 2 gets 10% discount
      if (dto.slotNo === 2) {
        priceAtPurchase = Number(priceAtPurchase) * 0.9;
      }
    }

    // Create or update slot
    const slot = await tx.graveSlot.upsert({
      where: {
        graveId_slotNo: {
          graveId: grave.id,
          slotNo: dto.slotNo,
        },
      },
      create: {
        graveId: grave.id,
        slotNo: dto.slotNo,
        purchaseId: deceased.purchaseId || null,
        priceAtPurchase: priceAtPurchase ? priceAtPurchase : null,
      },
      update: {
        purchaseId: deceased.purchaseId || null,
        priceAtPurchase: priceAtPurchase ? priceAtPurchase : null,
      },
    });

    // Link deceased to slot
    await tx.graveSlot.update({
      where: { id: slot.id },
      data: {
        deceasedId: dto.deceasedId,
      },
    });

    await tx.deceased.update({
      where: { id: dto.deceasedId },
      data: {
        status: BurialStatus.GRAVE_ASSIGNED,
      },
    });

    // Update assignment requests
    await tx.assignmentRequest.updateMany({
      where: {
        deceasedId: dto.deceasedId,
        status: AssignmentRequestStatus.PENDING,
      },
      data: {
        status: AssignmentRequestStatus.COMPLETED,
        assignedBy: staffId,
        assignedAt: new Date(),
      },
    });

    this.dashboardGateway.broadcastDashboardUpdate();

    return tx.deceased.findUnique({
      where: { id: dto.deceasedId },
      include: {
        graveSlot: {
          include: {
            grave: true,
          },
        },
        purchase: {
          include: {
            member: true,
            product: {
              select: {
                id: true,
                title: true,
                pricingSection: true,
                amount: true,
              },
            },
          },
        },
        waiver: true,
        nextOfKin: true,
      },
    });
  }

  /**
   * Update deceased record
   */
  async updateDeceased(id: string, dto: UpdateDeceasedDto) {
    const deceased = await this.prisma.deceased.findUnique({
      where: { id },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased record not found');
    }

    const updateData: any = {};

    if (dto.fullName !== undefined) updateData.fullName = dto.fullName;
    if (dto.dateOfBirth !== undefined)
      updateData.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.relationship !== undefined) updateData.relationship = dto.relationship;
    if (dto.causeOfDeath !== undefined) updateData.causeOfDeath = dto.causeOfDeath;
    if (dto.funeralParlor !== undefined) updateData.funeralParlor = dto.funeralParlor;
    if (dto.dateOfDeath !== undefined)
      updateData.dateOfDeath = dto.dateOfDeath ? new Date(dto.dateOfDeath) : null;
    if (dto.expectedBurial !== undefined)
      updateData.expectedBurial = dto.expectedBurial
        ? new Date(dto.expectedBurial)
        : null;
    if (dto.burialDate !== undefined)
      updateData.burialDate = dto.burialDate ? new Date(dto.burialDate) : null;
    if (dto.notes !== undefined) updateData.notes = dto.notes;
    if (dto.status !== undefined) updateData.status = dto.status;

    return this.prisma.deceased.update({
      where: { id },
      data: updateData,
      include: {
        purchase: {
          include: {
            member: true,
            product: {
              select: {
                id: true,
                title: true,
                pricingSection: true,
                amount: true,
              },
            },
          },
        },
        waiver: true,
        graveSlot: {
          include: {
            grave: true,
          },
        },
        nextOfKin: true,
      },
    });
  }

  /**
   * Lookup purchase by ID (for burial creation validation)
   */
  async lookupPurchase(purchaseId: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        paidAmount: true,
        balance: true,
        paidAt: true,
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        product: {
          select: {
            id: true,
            title: true,
            pricingSection: true,
            amount: true,
            category: true,
          },
        },
        deceased: {
          select: {
            id: true,
            fullName: true,
          },
        },
        graveSlot: {
          select: {
            id: true,
            slotNo: true,
            grave: {
              select: {
                section: true,
                graveNumber: true,
              },
            },
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException('Purchase not found');
    }

    return purchase;
  }

  /**
   * Mark burial as completed
   */
  async markBuried(id: string) {
    const deceased = await this.prisma.deceased.findUnique({
      where: { id },
    });

    if (!deceased) {
      throw new NotFoundException('Deceased record not found');
    }

    if (deceased.status !== BurialStatus.GRAVE_ASSIGNED) {
      throw new BadRequestException(
        'Burial must be assigned to a grave before marking as buried',
      );
    }

    return this.prisma.deceased.update({
      where: { id },
      data: {
        status: BurialStatus.BURIED,
        burialDate: deceased.burialDate || new Date(),
      },
      include: {
        purchase: {
          include: {
            member: true,
            product: {
              select: {
                id: true,
                title: true,
                pricingSection: true,
                amount: true,
              },
            },
          },
        },
        waiver: true,
        graveSlot: {
          include: {
            grave: true,
          },
        },
        nextOfKin: true,
      },
    });
  }
}
