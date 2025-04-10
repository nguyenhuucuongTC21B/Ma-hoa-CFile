// server/models/User.js
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    employeeId: {
      type: DataTypes.STRING(10),
      allowNull: false,
      unique: true,
      validate: {
        is: /^NV\d{3}$/i, // Định dạng NV001-NV129
        isUnique: async (value) => {
          const userCount = await sequelize.models.User.count();
          if (userCount >= 129) {
            throw new Error('Đã đạt tối đa 129 người dùng');
          }
        }
      }
    },
    fullName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    unitType: {
      type: DataTypes.ENUM(
        'Trung ương',
        'Tỉnh',
        'Thành phố',
        'Khu vực',
        'Cơ quan',
        'Cá nhân'
      ),
      allowNull: false
    },
    unitName: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
        isGmail(value) {
          if (!value.endsWith('@gmail.com')) {
            throw new Error('Chỉ chấp nhận địa chỉ Gmail');
          }
        }
      }
    },
    passwordHash: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    publicKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isPemFormat(value) {
          if (!value.includes('-----BEGIN PUBLIC KEY-----')) {
            throw new Error('Không đúng định dạng PEM');
          }
        }
      }
    },
    encryptedPrivateKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isEncrypted(value) {
          if (value.length < 500) {
            throw new Error('Khóa riêng phải được mã hóa');
          }
        }
      }
    },
    keyVersion: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      validate: {
        min: 1
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false // Mặc định chưa kích hoạt
    },
    isApproved: {
      type: DataTypes.BOOLEAN,
      defaultValue: false // Chờ admin phê duyệt
    },
    approvedBy: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Users',
        key: 'id'
      }
    },
    approvalDate: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastLogin: {
      type: DataTypes.DATE
    },
    lastKeyRotation: {
      type: DataTypes.DATE
    },
    isAdmin: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    hooks: {
      beforeCreate: async (user) => {
        // Tự động gán mã NV nếu chưa có
        if (!user.employeeId) {
          const lastUser = await sequelize.models.User.findOne({
            order: [['employeeId', 'DESC']]
          });
          const nextId = lastUser ? 
            parseInt(lastUser.employeeId.replace('NV', '')) + 1 : 1;
          user.employeeId = `NV${nextId.toString().padStart(3, '0')}`;
        }
      },
      afterCreate: async (user) => {
        // Gửi email thông báo cho admin
        if (!user.isAdmin) {
          await sequelize.models.Notification.create({
            type: 'NEW_REGISTRATION',
            targetId: user.id,
            message: `Người dùng ${user.fullName} đang chờ phê duyệt`
          });
        }
      },
      afterUpdate: async (user) => {
        // Gửi email khi được phê duyệt
        if (user.changed('isApproved') && user.isApproved) {
          await sequelize.models.EmailQueue.create({
            to: user.email,
            subject: 'Tài khoản của bạn đã được phê duyệt',
            body: `Xin chào ${user.fullName}, tài khoản ${user.employeeId} của bạn đã được kích hoạt.`
          });
        }
      }
    },
    indexes: [
      {
        unique: true,
        fields: ['employeeId']
      },
      {
        fields: ['unitType']
      },
      {
        fields: ['isApproved']
      }
    ]
  });

  // Quan hệ với các model khác
  User.associate = models => {
    User.hasMany(models.KeyPair, {
      foreignKey: 'userId',
      as: 'keyPairs'
    });

    User.hasMany(models.Session, {
      foreignKey: 'userId',
      as: 'sessions'
    });

    User.hasMany(models.Document, {
      foreignKey: 'ownerId',
      as: 'documents'
    });

    User.hasMany(models.KeyRotationLog, {
      foreignKey: 'userId',
      as: 'keyRotations'
    });

    // Người phê duyệt
    User.belongsTo(models.User, {
      foreignKey: 'approvedBy',
      as: 'approver'
    });

    User.hasMany(models.Notification, {
      foreignKey: 'targetId',
      constraints: false,
      scope: {
        targetType: 'USER'
      }
    });
  };

  // ========== Các phương thức mở rộng ========== //

  /**
   * Phê duyệt người dùng (admin-only)
   */
  User.approveUser = async function(adminId, userId) {
    const user = await this.findByPk(userId);
    if (!user) throw new Error('Người dùng không tồn tại');
    
    return await user.update({
      isApproved: true,
      isActive: true,
      approvedBy: adminId,
      approvalDate: new Date()
    });
  };

  /**
   * Từ chối đăng ký (admin-only)
   */
  User.rejectUser = async function(adminId, userId, reason) {
    const user = await this.findByPk(userId);
    if (!user) throw new Error('Người dùng không tồn tại');
    
    await sequelize.models.EmailQueue.create({
      to: user.email,
      subject: 'Đơn đăng ký của bạn bị từ chối',
      body: `Lý do: ${reason}`
    });
    
    return await user.destroy();
  };

  /**
   * Lấy danh sách chờ phê duyệt
   */
  User.getPendingUsers = function() {
    return this.findAll({
      where: {
        isApproved: false,
        isAdmin: false
      },
      order: [['createdAt', 'ASC']]
    });
  };

  return User;
};
