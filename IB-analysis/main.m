cd ~
cd Desktop/
cd MIT-projects/
cd IB-analysis/

clear all; close all; clc;
% analysis; close all; clc;

% ==> PARAMETERS

epsilon = 1e-4;              %1e-4 %1e-6 % *****
percision = 10^-100;          %10^-50 %10^-308;
% epsilon = 1e-6; % *****
% percision = 10^-308;

% ==> MOTION KINEMATICS 
% f = 'qpos';
% f = 'qpos_gc';
% f = 'qvel';
% f = 'qvel_gc';
% f = 'qfrc_actuator';
% f = 'qfrc_actuator_gc';
% f = 'qpwr';
% f = 'qpwr_gc';
f = 'gait_features'
% f = 'prolific_similarity'

% ==> D METRIC
D_METRIC = 'cosine'; FIT_GAMMA_UNCERTAINTY = true %false
% D_METRIC = 'EMD'; FIT_GAMMA_UNCERTAINTY = true %false
% D_METRIC = 'soft-dtw'; FIT_GAMMA_UNCERTAINTY = false %false

% ==> GAMMA (if applicable)
GAMMA = '0.0'; 
% GAMMA = '0.2'; 
% GAMMA = '0.4'; 
% GAMMA = '0.6'; 
% GAMMA = '0.8'; 
% GAMMA = '1.0'; 

% ==> fit gamma uncertainty procedure? or not?
% FIT_GAMMA_UNCERTAINTY = false %false

% ==> paths
% ti = 'UROP'; 
ti = 'Motivo';



if strcmp(ti,'Motivo')
    % ==> meta motivo JSMF =======================================================================
    % dr = '/home/thomas/Desktop/MIT-projects/meta-motivo-features/data/test-mosaic/DTW-sm/';
    % dr = '/home/thomas/Desktop/MIT-projects/meta-motivo-features/data/walk-run/DTW-sm/';

    if strcmp(D_METRIC,'soft-dtw')
        dr = ['/home/thomas/Desktop/MIT-projects/meta-motivo-features/data/walk-run-antiphase-ext-res-36/', f, '/', D_METRIC, '/', 'gamma-', GAMMA, '/'];
    elseif strcmp(D_METRIC,'EMD')
        dr = ['/home/thomas/Desktop/MIT-projects/meta-motivo-features/data/walk-run-antiphase-ext-res-36/', f, '/', D_METRIC, '/', 'gamma-', GAMMA(1), '/'];
    elseif strcmp(D_METRIC,'cosine')
        dr = ['/home/thomas/Desktop/MIT-projects/meta-motivo-features/data/walk-run-antiphase-ext-res-36/', f, '/', D_METRIC, '/', 'gamma-', GAMMA(1), '/'];
    end
    G = [1:100, 100:100:12000]; %1:0.1:300; % ==> starting values
    PRIOR = 'UNIFORM'; 
    % ==> load labels and load similarity
    % sm_mds = load([dr,'sm.mat']);
    if strcmp(D_METRIC,'soft-dtw')
        sm_mds = load([dr,'sm', '_', f, '_gamma_',  GAMMA, '.mat']);
    elseif strcmp(D_METRIC,'EMD')
        sm_mds = load([dr,'sm', '_', f, '_gamma_',  GAMMA(1), '.mat']);
    elseif strcmp(D_METRIC,'cosine')
        sm_mds = load([dr,'sm', '_', f, '_gamma_',  GAMMA(1), '.mat']);
    end

    % ==> betas
    %betas = fliplr([0,logspace(0,1,250), logspace(1,3.5,50) ]);
    %betas = fliplr([0,logspace(0,1,350), logspace(1,5,100) ]);
    % betas = fliplr([0,logspace(0,1,800), logspace(1,5,150) ]);

    % betas = fliplr([0,logspace(0,1,3000), logspace(1,5,2000) ]);
    % walk-run
    betas = fliplr([0,logspace(0,1,2000), logspace(1,5,1000) ]); %% ==> THIS WAS USED FOR ALL MODELS!

    % %%betas = fliplr([0, logspace(0,0.01,2400), logspace(0.01,0.05,300), logspace(0.05,1,200), logspace(1,5,100) ]);

    % ==> load dissimilarity matrix
    sm = sm_mds.sm;
    % ==> load labels
    labels = sm_mds.labels;
    J = length(labels);
    % ==> scale similarity values to between 0 and 1.
    sm = sm./max(sm(:));

    % ==> PROJECT LOCOMOTION FEATURE?
    PROJECT = false

    if PROJECT
        % ========================================
        % ==> try lower dimensional version % ****
        proj = sm_mds.proj;
        sm = pdist2(proj, proj);
        % ========================================
    end       
    % ============================================================================================
end
if strcmp(ti,'UROP')
    % ==> UROP ===================================================================================
    dr = '/home/thomas/Desktop/MIT-projects/UROP/'
    G = 1:0.1:300; % ==> starting values
    PRIOR = 'NON-UNIFORM';
    % ==> load labels and load similarity
    sm_mds = load([dr,'sm.mat']);

    % ==> betas
    % ==> should read-in Noga's beta values... sheesh....
    betas = fliplr(sm_mds.betas);

    % betas = fliplr([0,logspace(0,1,1500),logspace(1,3.5,1500)]); %,logspace(2,4,1500)]); % *****    
    epsilon = 1e-4; %1e-6 % *****
    percision = 10^-50; %10^-308;


    % ==> load dissimilarity matrix
    sm = sm_mds.sm;
    % ==> load labels
    labels = sm_mds.labels;
    J = length(labels);    
    % ==> scale similarity values to between 0 and 1.
    sm = sm./max(sm(:));    
    % ============================================================================================
end

%%


% ==> Setting up the speaker's uncertainty parameter gamma

if FIT_GAMMA_UNCERTAINTY

    % ==> perceptual uncertainty 
    % ==> store I(M;U)s
    IMUs = nan(length(G),1);
    
    % ==> meaning matrices
    mvVs = nan(J,J,length(G));
    % ==> compute meanings as gaussians in original similarity space
    
    % ==> for each gamma setting
    for g = 1:length(G)
    
        % ==> function for defining meanings over similarity space
        puf = @(sim) (exp(G(g)*sim));
        
        % ==> generate meanings
        mvV = arrayfun(puf,sm);   
        %assert(unique(mvV == mvV'))
    
        % ==> normalize. ROWS should sum to 1
        mvV = mvV./repmat(sum(mvV,2),[1,J]);
        %assert(unique(sum(mvV,2) - 1 < 10^(-12)))
        %mvV = mvV./sum(mvV);
        mvVs(:,:,g) = mvV;
    
        if strcmp(PRIOR,'UNIFORM')
            % ==> p(m) distribution (uniform for now)
            pv = repmat(1/size(mvV,1),[1,size(mvV,1)]);
            pm = pv;
        else
            % ==> UROP...
            pv = sm_mds.pm;
            pm = pv;
        end
    
        % ==> checks
        %assert(unique((sum(mvV,2) - 1) < 10^(-12) == 1))
        % figure(1); imagesc(mvV); colorbar;
    
        % ==> weigh each meaning (column in m(v)) by corresponding prior value p(m).
        pu = mvV*pm'; % ==> meanings m(v) multiplied by prior over meanings p(m)
    
        % ==> compute accuracy bound conditioned on gamma value
        IMUmx = 0;
        for u = 1:J
            for c = 1:J
                IMUmx = IMUmx + sum( mvV(c,u)*pm(u)' *log2(mvV(c,u)./pu(u)));                  
            end
        end
        % ==> store I(M;U) value
        IMUs(g) = IMUmx;
    
        fprintf('computed for log(gamma) = %d value %d of %d...\n',log2(G(g)),g,length(G))
    end
    
    % ==> mid point
    md = max(IMUs)/2;
    % ==> find intersection on the curve
    idx = find(abs(IMUs - md) == min(abs(IMUs - md)));
    
% ==> UGH!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
% fprintf('DISCREPANCY WITH UNCERTAINTY GAMMA RESULTS FOR IB COMPLEXITY AND ACCURACY RANGES UGH SIGH UGH...\n') 
% idx = 1 % ==> WHY ARE THE COMPLEXITY VALUES DIFFERENT????????
% % ===> UNCLEAR WHY THERE IS A DISCREPANCY WITH CONTAINERS 

    % ==> gamma choice
    gamma = log2(G(idx));
    % ==> define best mvV with gamma
    mvV = mvVs(:,:,idx);                    
    
                        %gamma = log2(G(idx + 20));
                        %mvV = mvVs(:,:,idx+20);
    
    figure(1); set(gcf,'position',[222 617 890 369]); set(gcf,'color','white');
    subplot(1,2,1); imagesc(mvVs(:,:,idx)); title(['Example m(v), log(\gamma) = ',num2str(gamma)]); axis square;
    ax = gca;
    ax.YTick = 1:length(labels);
    ax.YTickLabel = labels;
    ax.YAxis.FontSize = 4;
    title(['Intended meanings m(u), ', '$$log_2(\gamma)$$ = ',num2str(gamma), ', I(M;U) = ', num2str(md)],'Interpreter','Latex');
    axis equal;
    axis tight;
    axis square;
    drawnow;
    subplot(1,2,2); plot(log2(G),IMUs,'b-.'); axis square; axis tight;
    xlabel('log(\gamma)'); ylabel('I(M;U)'); 
    title("Speaker' memory capacity",'Interpreter','Latex');
    hold on; hold all;
    plot(log2(G),repmat(md,[length(G),1]),'r--');
    plot(repmat(log2(G(idx)),[length(IMUs),1]),IMUs,'r--');
    drawnow;
end




if ~FIT_GAMMA_UNCERTAINTY
    % ==> OPTION - USE GAMMA FROM DTW AS THE 'GAMMA' PARAMETER
    
    % ==> This is for using MOTIVO QPOS & QVEL DTW similarity as is
    % sm = sm + abs(min(sm(:)));
    sm = sm./sum(sm,2);
    mvV = sm;
    figure(); imagesc(mvV);
    fprintf('Not fitting gamma uncertainty parameter...\n')

    if strcmp(PRIOR,'UNIFORM')
        % ==> p(m) distribution (uniform for now)
        pv = repmat(1/size(mvV,1),[1,size(mvV,1)]);
        pm = pv;
    else
        % ==> UROP...
        pv = sm_mds.pm;
        pm = pv;
    end

end




%%




BT = 0
%%% % ========= RANDOM PERMUTATION ==========
%%MX_BT = 1000;
%%for BT = 1:MX_BT

%   clc;
%%rperm = randperm(J);
%%pYX = mvV(rperm,rperm); % ==> p(u|m)
%%% % =======================================

% p(u|m) ==> columns are meanings, rows are the set of u gestures
pYX = mvV; % ==> p(u|m)

% p(m)
pX = pm;

% joint p(m,u) = p(u|m)*p(m)
% ==> columns of p(u|m) are weighted by probabilities in the prior p(m)
pXY = pYX.*repmat(pX,[J,1]); assert(sum(pXY(:)));

% encoder q(w|m)
% ==> starting pT_X
pT_X = eye(J);

% Ixs & Iys
Ixs = nan(1,length(betas));
Iys = nan(1,length(betas));

% ==> q(w|m) encoders
pT_Xs = {};
% ==> qbW
pTs = {};

% ==> posteriors ('inverse encoder')
pX_Ts = {};

for i = 1:length(betas)
    beta = betas(i);

    [Ix, Iy, pT_X, pY_T, pT] = IB(pXY,pT_X,beta,epsilon,percision);

    Ixs(i) = Ix;
    Iys(i) = Iy;

    % ==> Encoder, q(w|m)
    % ==> check that rows sum to 1
    %assert(all(sum(pT_X,2) - 1 < eps*10))
    pT_Xs{i} = pT_X;

    pY_Ts{i} = pY_T;
    pTs{i} = pT;

    % ==> Bayesian listener, Bayesian posterior, inverse encoder, q(m|w).
    pX_T = pT_X.*repmat(pX,[J,1]) ./ sum(pT_X.*repmat(pX,[J,1]),1); 

    % ==> check that columns sum to 1
    %assert(all(sum(pX_T,1) - 1 < eps*10))

    pX_Ts{i} = pX_T;

    fprintf('Finished IB for beta value %d of %d...\n',i,length(betas))
end

% % ===================== convert?
Ixs = Ixs*log2(exp(1));
Iys = Iys*log2(exp(1));
% % ==============================
IB_curve = [Ixs;Iys]';

figure(2); hold on; hold all;
clf; set(gcf,'color','white'); 
plot(Ixs,Iys,'r.-');
ylabel('I(W;U) (bits)'); 
xlabel('I(M;W) (bits)');
title('Information Plane');
axis tight;

qW_M = nan(length(betas),J,J);
for i = 1:length(betas)
    qW_M(i,:,:) = pT_Xs{i};
end

mu_m = pYX;


% dr_ext = '/media/thomas/U/cogsci-2025/eval-data/';

save([dr,'mu-mat', num2str(BT), '.mat'],'mu_m','-v7.3')
save([dr,'betas', num2str(BT), '.mat'],'betas','-v7.3')
save([dr,'pM', num2str(BT), '.mat'],'pX','-v7.3')
save([dr,'IB_curve', num2str(BT), '.mat'],'IB_curve','-v7.3')
save([dr,'qW_M', num2str(BT), '.mat'],'qW_M','-v7.3')

fprintf('saved all IB model files...')
% fprintf('saved all the model components for BT=%d of %d...\n',BT,MX_BT)

%end

