function [Ix, Iy, pT_X, pY_T, pT] = IB(pXY,pT_X,beta,epsilon,percision)

    % init
    [m n] = size(pXY);     % m = |X| , n = |Y|
    pX = sum(pXY,2)';
    pY = sum(pXY,1)';

    pY_X = bsxfun(@rdivide,pXY,pX');
    k = size(pT_X,2);      % k = |T| 
    % disp(['Running IB with \beta = ' num2str(beta) ' and k = ' num2str(k)]);

    % epsilon = 1e-6 % *****
    % percision = 10^-308;
    Hy = -pY(pY~=0)'*log(pY(pY~=0));

    pT_X_prev = 0*pT_X;
    Hy_x = repmat(sum(pY_X.*log(pY_X+percision),2),1,k);
    
    itr = 0;
    
    % tic
    while(any(abs(pT_X_prev(:)-pT_X(:)) > epsilon))
        
        itr = itr + 1;
        % if mod(itr,1000) == 0
        %     dP = max(abs(pT_X_prev(:)-pT_X(:)));
        %     disp(['iteration #' num2str(itr) ', dpT_X = ' num2str(dP)]);
        % end
        pT_X_prev = pT_X;
        pT = pX*pT_X;
        pY_T = (pXY'*pT_X)./repmat(pT,n,1);  

        pT_X = bsxfun(@times,exp(-beta.*(Hy_x- pY_X*log(pY_T+percision))),pT);
        pT_X = bsxfun(@rdivide,pT_X,sum(pT_X,2));
    end
    % toc
    
    Iy = MI(pY_T,pT,Hy);
    Ix = MI(pT_X',pX,H(pT));


%=========== internal functions ===========%
    function h = H(px)
        temp = px.*log(px);
        temp(px == 0) = 0;
        h = -sum(temp);
    end

    function I = MI(p_y_x,p_x,Hy)
        H_Y_X = p_y_x.*log(p_y_x);
        H_Y_X(p_y_x == 0) = 0;
        I = Hy + sum(H_Y_X,1)*p_x';
    end
%=========================================%

end





