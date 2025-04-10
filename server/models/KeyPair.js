// server/models/KeyPair.js
module.exports = (sequelize, DataTypes) => {
  const KeyPair = sequelize.define('KeyPair', {
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Users',
        key: 'id'
      },
      onDelete: 'CASCADE' // Tự động xóa khi user bị xóa
    },
    publicKey: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isValidPublicKey(value) {
          if (!value.startsWith('-----BEGIN PUBLIC KEY-----')) {
            throw new Error('Invalid public key format');
          }
        }
      }
    },
    privateKeyEncrypted: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isEncrypted(value) {
          if (!value.startsWith('$AES$') && value.length < 500) {
            throw new Error('Private key must be properly encrypted');
          }
        }
      }
    },
    keyAlgorithm: {
      type: DataTypes.ENUM(
        'RSA-OAEP',
        'RSA-PSS',
        'ECDSA',
        'ECDH',
        'AES-GCM'
      ),
      defaultValue: 'RSA-OAEP'
    },
    keySize: {
      type: DataTypes.INTEGER,
      defaultValue: 2048,
      validate: {
        min: 1024,
        max: 4096
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
      defaultValue: true
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      validate: {
        isFutureDate(value) {
          if (value && new Date(value) <= new Date()) {
            throw new Error('Expiration date must be in the future');
          }
        }
      }
    },
    lastUsedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    keyUsage: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    keyMetadata: {
      type: DataTypes.JSONB,
      defaultValue: {}
    }
  }, {
    hooks: {
      beforeCreate: async (keyPair) => {
        // Tự động đặt hạn sử dụng mặc định 1 năm
        if (!keyPair.expiresAt) {
          const oneYearLater = new Date();
          oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
          keyPair.expiresAt = oneYearLater;
        }

        // Đảm bảo chỉ có 1 key active cho mỗi user
        if (keyPair.isActive) {
          await sequelize.models.KeyPair.update(
            { isActive: false },
            { where: { userId: keyPair.userId } }
          );
        }
      },
      afterUpdate: async (keyPair) => {
        // Ghi log khi key bị thu hồi
        if (keyPair.changed('isActive') && !keyPair.isActive) {
          await sequelize.models.KeyRevocationLog.create({
            keyPairId: keyPair.id,
            userId: keyPair.userId,
            reason: 'MANUAL_DEACTIVATION'
          });
        }
      }
    },
    indexes: [
      {
        unique: true,
        fields: ['userId', 'keyVersion']
      },
      {
        fields: ['expiresAt']
      },
      {
        fields: ['isActive']
      }
    ],
    paranoid: true // Kích hoạt soft delete
  });

  KeyPair.associate = models => {
    KeyPair.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user',
      onDelete: 'CASCADE'
    });

    KeyPair.hasMany(models.EncryptionLog, {
      foreignKey: 'keyPairId',
      as: 'encryptionLogs'
    });

    KeyPair.hasMany(models.KeyRevocationLog, {
      foreignKey: 'keyPairId',
      as: 'revocationLogs'
    });
  };

  // ===== Các phương thức nghiệp vụ ===== //

  /**
   * Thu hồi khóa
   */
  KeyPair.prototype.revoke = async function(reason = 'SECURITY_REASONS') {
    await this.update({ isActive: false });
    
    await sequelize.models.KeyRevocationLog.create({
      keyPairId: this.id,
      userId: this.userId,
      reason: reason
    });

    return this;
  };

  /**
   * Gia hạn khóa
   */
  KeyPair.prototype.renew = async function(extensionMonths = 12) {
    const newExpiry = new Date(this.expiresAt);
    newExpiry.setMonth(newExpiry.getMonth() + extensionMonths);
    
    return await this.update({
      expiresAt: newExpiry,
      lastUsedAt: new Date()
    });
  };

  /**
   * Lấy thông tin khóa dạng PEM
   */
  KeyPair.prototype.getPublicKeyPem = function() {
    return `-----BEGIN PUBLIC KEY-----\n${this.publicKey}\n-----END PUBLIC KEY-----`;
  };

  return KeyPair;
};
