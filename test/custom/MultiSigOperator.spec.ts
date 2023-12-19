import "module-alias/register";

import {
  getAccounts,
  getSystemFixture,
  getWaffleExpect,
} from "@utils/test/index";

import DeployHelper from "@utils/deploys";
import { ether } from "@utils/common";
import { BigNumber } from "ethers";
import { StreamingFeeState } from "@utils/types";
import { ZERO } from "@utils/constants";
import hre from "hardhat";
import { Account } from "@utils/test/types";
import { Contract } from "ethers";
import { StreamingFeeModule, GeneralIndexModule } from "@utils/contracts/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("MultiSigOperator", () => {
  let manager: Account;
  let methodologist: Account;
  let operator: Account;
  let ownerAccounts: Account[];
  let owners: string[];
  let numConfirmationsRequired: number;
  let MultiSigInstance: Contract;
  let mockR: any[];
  let mockOracle: Contract;
  const mockTokens: Contract[] = [];
  const mockTokenUnits: BigNumber[] = [];
  let streamingFeeModule: StreamingFeeModule;
  let indexModule: GeneralIndexModule;
  let setup: SystemFixture;

  before(async () => {

    [manager, methodologist, operator, operator, ...ownerAccounts] = await getAccounts();

    // Assuming that the addresses are needed for deployment and interactions
    owners = ownerAccounts.map(account => account.address);
    numConfirmationsRequired = 3;
    // Mock Oracle
    const MockOracle = await hre.ethers.getContractFactory("MockOracle");
    mockOracle = await MockOracle.deploy();
    await mockOracle.deployed();

    // Deploy 10 MockTokens and set their units
    for (let i = 0; i < 10; i++) {
      const MockToken = await hre.ethers.getContractFactory("MockToken");
      const mockToken = await MockToken.deploy(`MockToken${i}`, `MTK${i}`, 18);
      await mockToken.deployed();
      mockTokens.push(mockToken);
    }

    // Set rates for 10 tokens to WETH in the MockOracle
    for (const mockToken of mockTokens) {
      const rateToWETH = BigNumber.from(Math.floor(Math.random() * 50) + 1);
      await mockOracle.setRate(mockToken.address, rateToWETH);
      mockTokenUnits.push(rateToWETH);
    }

    mockR = [[], [], mockTokenUnits, 1];

    // Deploy system
    const deployer = new DeployHelper(manager.wallet);

    setup = getSystemFixture(manager.address);

    await setup.initialize();

    // StreamingFeeModule Deployment
    streamingFeeModule = await deployer.modules.deployStreamingFeeModule(setup.controller.address);
    await setup.controller.addModule(streamingFeeModule.address);

    // IndexModule Deployment
    indexModule = await deployer.modules.deployGeneralIndexModule(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(indexModule.address);

  });

  beforeEach(async () => {

    // Deploy SetToken with issuanceModule, TradeModule, and StreamingFeeModule
    let setToken = await setup.createSetToken(
      mockTokens.map(mockToken => mockToken.address),
      mockTokenUnits,
      [
        setup.navIssuanceModule.address,
        streamingFeeModule.address,
        indexModule.address,
      ],
      manager.address,
      "SetToken",
      "SET"
    );

    // Deploy ICManager
    const ICManager = await hre.ethers.getContractFactory("ICManager");
    let icManagerInstance = await ICManager.deploy(
      setToken.address, indexModule.address, streamingFeeModule.address, operator.address, methodologist.address, 0
    );
    await icManagerInstance.deployed();

    // Initialize StreamingFeeModule
    const streamingFeePercentage = ether(.02);
    const subjectSettings = {
      feeRecipient: manager.address,
      maxStreamingFeePercentage: ether(.1),
      streamingFeePercentage: streamingFeePercentage,
      lastStreamingFeeTimestamp: ZERO,
    } as StreamingFeeState;
    streamingFeeModule = streamingFeeModule.connect(manager.wallet);
    await streamingFeeModule.initialize(setToken.address, subjectSettings);
    await setToken.isInitializedModule(streamingFeeModule.address);

    // Initialize IndexModule
    indexModule = indexModule.connect(manager.wallet);
    await indexModule.initialize(setToken.address);
    await setToken.isInitializedModule(indexModule.address);

    // Change fee recipient
    const newFeeRecipient = methodologist.address;
    await streamingFeeModule.updateFeeRecipient(setToken.address, newFeeRecipient);

    // Update Manager
    setToken = setToken.connect(manager.wallet);
    await setToken.setManager(icManagerInstance.address);

    // Deploy MultiSigOperator
    const MultiSigOperator = await hre.ethers.getContractFactory("MultiSigOperator");
    MultiSigInstance = await MultiSigOperator.deploy(
      owners, 3, 5, operator.address, icManagerInstance.address
    );
    await MultiSigInstance.deployed();

    // Update Operator
    icManagerInstance = icManagerInstance.connect(operator.wallet);
    await icManagerInstance.updateOperator(MultiSigInstance.address);
  });


  describe("Transaction submission", () => {
    it("should allow the operator to submit a transaction", async () => {
      MultiSigInstance = MultiSigInstance.connect(operator.wallet);
      const tx = await MultiSigInstance.submitRebalance(...mockR);
      await expect(tx).to.emit(MultiSigInstance, "SubmitRebalance");
    });

    it("should not allow non-operators to submit a transaction", async () => {
      MultiSigInstance = MultiSigInstance.connect(manager.wallet);
      await expect(
        MultiSigInstance.submitRebalance(...mockR)
      ).to.be.revertedWith("not operator");
    });
  });

  describe("Transaction confirmation", () => {
    beforeEach(async () => {
      MultiSigInstance = MultiSigInstance.connect(operator.wallet);
      await MultiSigInstance.submitRebalance(...mockR);
    });

    it("should allow owners to confirm a transaction", async () => {
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      const tx = await MultiSigInstance.confirmTransaction();
      await expect(tx).to.emit(MultiSigInstance, "ConfirmRebalance");
    });

    it("should not allow non-owners to confirm a transaction", async () => {
      MultiSigInstance = MultiSigInstance.connect(manager.wallet); // user1 is not an owner
      await expect(
        MultiSigInstance.confirmTransaction()
      ).to.be.revertedWith("not owner");
    });

    it("should not allow confirming a transaction more than once by the same owner", async () => {
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      await MultiSigInstance.confirmTransaction();
      await expect(
        MultiSigInstance.confirmTransaction()
      ).to.be.revertedWith("rebalance already confirmed");
    });

    it("should not allow confirming a transaction if already executed", async () => {
      for (const account of ownerAccounts.slice(0, numConfirmationsRequired)) {
        await MultiSigInstance.connect(account.wallet).confirmTransaction();
      }
      await MultiSigInstance.connect(ownerAccounts[0].wallet).executeTransaction();
      await expect(
        MultiSigInstance.connect(ownerAccounts[0].wallet).confirmTransaction()
      ).to.be.revertedWith("rebalance already executed");
    });
  });

  describe("Transaction execution", () => {
    beforeEach(async () => {
      MultiSigInstance = MultiSigInstance.connect(operator.wallet);
      await MultiSigInstance.submitRebalance(...mockR);
      // Add confirmations
      for (const account of ownerAccounts.slice(0, numConfirmationsRequired)) {
        await MultiSigInstance.connect(account.wallet).confirmTransaction();
      }
    });

    it("should execute a transaction when required confirmations are met", async () => {
      const tx = await MultiSigInstance.connect(ownerAccounts[0].wallet).executeTransaction();
      await expect(tx).to.emit(MultiSigInstance, "ExecuteRebalance");
    });

    it("should not execute a transaction when required confirmations are not met", async () => {
      // Reset to a state where not enough confirmations are present
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      MultiSigInstance.revokeConfirmation();
      await expect(
        MultiSigInstance.connect(ownerAccounts[0].wallet).executeTransaction()
      ).to.be.revertedWith("cannot execute rebalance");
    });

    it("should not allow non-owners to execute a transaction", async () => {
      MultiSigInstance = MultiSigInstance.connect(manager.wallet); // user1 is not an owner
      await expect(
        MultiSigInstance.executeTransaction()
      ).to.be.revertedWith("not owner");
    });
  });

  describe("Transaction revocation", () => {
    beforeEach(async () => {
      MultiSigInstance = MultiSigInstance.connect(operator.wallet);
      await MultiSigInstance.submitRebalance(...mockR);
      await MultiSigInstance.connect(ownerAccounts[0].wallet).confirmTransaction();
    });

    it("should allow owners to revoke their confirmation", async () => {
      const tx = await MultiSigInstance.connect(ownerAccounts[0].wallet).revokeConfirmation();
      await expect(tx).to.emit(MultiSigInstance, "RevokeConfirmation");
    });

    it("should not allow non-owners to revoke confirmations", async () => {
      MultiSigInstance = MultiSigInstance.connect(manager.wallet); // user1 is not an owner
      await expect(
        MultiSigInstance.revokeConfirmation()
      ).to.be.revertedWith("not owner");
    });

    it("should not allow revoking a confirmation more than once by the same owner", async () => {
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      await MultiSigInstance.revokeConfirmation();
      await expect(
        MultiSigInstance.revokeConfirmation()
      ).to.be.revertedWith("rebalance not confirmed");
    });

    it("should not allow revoking a confirmation if not confirmed", async () => {
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[1].wallet);
      await expect(
        MultiSigInstance.revokeConfirmation()
      ).to.be.revertedWith("rebalance not confirmed");
    });

    it("should not allow revoking a confirmation if already executed", async () => {
      for (const account of ownerAccounts.slice(1, numConfirmationsRequired)) {
        await MultiSigInstance.connect(account.wallet).confirmTransaction();
      }
      await MultiSigInstance.connect(ownerAccounts[0].wallet).executeTransaction();
      await expect(
        MultiSigInstance.connect(ownerAccounts[0].wallet).revokeConfirmation()
      ).to.be.revertedWith("rebalance already executed");
    });
  });

  describe("Submit new operator", () => {
    it("should allow an owner to submit a new operator", async () => {
      const newOperator = ownerAccounts[1].address; // Assuming ownerAccounts[1] is not the current operator
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      const tx = await MultiSigInstance.submitNewOperator(newOperator);
      await expect(tx).to.emit(MultiSigInstance, "SubmitNewOperator").withArgs(newOperator);
    });

    it("should not allow a non-owner to submit a new operator", async () => {
      const newOperator = ownerAccounts[1].address;
      MultiSigInstance = MultiSigInstance.connect(manager.wallet);
      await expect(
        MultiSigInstance.submitNewOperator(newOperator)
      ).to.be.revertedWith("not owner");
    });
  });

  describe("Confirm new operator", () => {
    beforeEach(async () => {
      const newOperator = ownerAccounts[1].address;
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      await MultiSigInstance.submitNewOperator(newOperator);
    });

    it("should allow an owner to confirm the new operator", async () => {
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[1].wallet);
      const tx = await MultiSigInstance.confirmNewOperator();
      await expect(tx).to.emit(MultiSigInstance, "ConfirmNewOperator");
    });

    it("should not allow a non-owner to confirm the new operator", async () => {
      MultiSigInstance = MultiSigInstance.connect(manager.wallet);
      await expect(
        MultiSigInstance.confirmNewOperator()
      ).to.be.revertedWith("not owner");
    });

    it("should not allow confirming the new operator more than once by the same owner", async () => {
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      await expect(
        MultiSigInstance.confirmNewOperator()
      ).to.be.revertedWith("operator already confirmed");
    });
  });

  describe("Execute new operator", () => {
    beforeEach(async () => {
      const newOperator = ownerAccounts[1].address;
      MultiSigInstance = MultiSigInstance.connect(ownerAccounts[0].wallet);
      await MultiSigInstance.submitNewOperator(newOperator);
    });

    it("should execute the new operator when required confirmations are met", async () => {
      for (const account of ownerAccounts.slice(1, 6)) {
        await MultiSigInstance.connect(account.wallet).confirmNewOperator();
      }
      const tx = await MultiSigInstance.connect(ownerAccounts[0].wallet).executeNewOperator();
      await expect(tx).to.emit(MultiSigInstance, "NewOperator");
    });

    it("should not execute the new operator when required confirmations are not met", async () => {
      await expect(
        MultiSigInstance.connect(ownerAccounts[0].wallet).executeNewOperator()
      ).to.be.revertedWith("cannot execute new operator");
    });

    it("should not allow a non-owner to execute the new operator", async () => {
      for (const account of ownerAccounts.slice(1, 6)) {
        await MultiSigInstance.connect(account.wallet).confirmNewOperator();
      }
      MultiSigInstance = MultiSigInstance.connect(manager.wallet);
      await expect(
        MultiSigInstance.executeNewOperator()
      ).to.be.revertedWith("not owner");
    });
  });
});
